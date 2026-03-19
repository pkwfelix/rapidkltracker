import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import protobuf from "protobufjs";
import { POLL_INTERVAL_MS, SERVER_PORT } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "cache");
const PROTO_PATH = path.join(__dirname, "gtfs-realtime.proto");

export interface VehiclePosition {
  vehicleId: string;
  tripId: string;
  routeId: string;
  latitude: number;
  longitude: number;
  currentStopSequence?: number;
  currentStopId?: string;
  timestamp?: number;
  agency: string;
}

export interface CachePayload {
  updatedAt: number;
  positions: VehiclePosition[];
}

type Group = "bus" | "train";

const FEEDS: Record<Group, { key: string; url: string }[]> = {
  bus: [
    { key: "rapid-bus-kl",       url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl" },
    { key: "rapid-bus-mrtfeeder", url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder" },
  ],
  train: [
    { key: "ktmb", url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb" },
  ],
};

// SSE subscribers — map of group → set of response objects
const sseClients: Record<Group, Set<Response>> = { bus: new Set(), train: new Set() };

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── Protobuf ─────────────────────────────────────────────────────────────────

let FeedMessage: protobuf.Type | null = null;

async function loadProto(): Promise<void> {
  const root = await protobuf.load(PROTO_PATH);
  FeedMessage = root.lookupType("transit_realtime.FeedMessage");
  console.log("[proto] Loaded gtfs-realtime.proto");
}

// ── Polling ───────────────────────────────────────────────────────────────────

async function fetchFeed(key: string, url: string): Promise<VehiclePosition[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${key}`);
  const buf = await res.arrayBuffer();
  const msg = FeedMessage!.decode(new Uint8Array(buf));
  const obj = FeedMessage!.toObject(msg, { longs: Number, enums: String }) as any;

  const positions: VehiclePosition[] = [];
  for (const entity of obj.entity || []) {
    const v = entity.vehicle;
    if (!v) continue;
    const trip = v.trip || {};
    const pos  = v.position || {};
    const veh  = v.vehicle || {};
    if (!pos.latitude && !pos.longitude) continue;
    positions.push({
      vehicleId:           veh.id || entity.id || "",
      tripId:              trip.tripId  || trip.trip_id  || "",
      routeId:             trip.routeId || trip.route_id || "",
      latitude:            pos.latitude  || 0,
      longitude:           pos.longitude || 0,
      currentStopSequence: v.currentStopSequence ?? v.current_stop_sequence ?? undefined,
      currentStopId:       v.stopId || v.stop_id || undefined,
      timestamp:           v.timestamp || undefined,
      agency:              key,
    });
  }
  return positions;
}

async function pollGroup(group: Group): Promise<void> {
  const feeds = FEEDS[group];
  const results = await Promise.allSettled(feeds.map(f => fetchFeed(f.key, f.url)));

  const positions = results.flatMap((r, i) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[poll] ${feeds[i].key} failed: ${(r.reason as Error)?.message}`);
    return [];
  });

  const payload: CachePayload = { updatedAt: Date.now(), positions };
  const cachePath = path.join(CACHE_DIR, `${group}.json`);
  fs.writeFileSync(cachePath, JSON.stringify(payload));
  console.log(`[poll] ${group}: ${positions.length} vehicles — ${new Date().toISOString()}`);

  // Notify SSE subscribers for this group
  const event = `data: ${JSON.stringify({ updatedAt: payload.updatedAt })}\n\n`;
  for (const client of sseClients[group]) {
    try { client.write(event); } catch { sseClients[group].delete(client); }
  }
}

async function pollAll(): Promise<void> {
  await Promise.allSettled([pollGroup("bus"), pollGroup("train")]);
}

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());

function sendCache(res: Response, group: Group): void {
  const cachePath = path.join(CACHE_DIR, `${group}.json`);
  if (!fs.existsSync(cachePath)) {
    res.status(503).json({ error: "Cache not ready yet" });
    return;
  }
  const raw = fs.readFileSync(cachePath, "utf8");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.send(raw);
}

app.get("/api/vehicles/bus",   (_req: Request, res: Response) => sendCache(res, "bus"));
app.get("/api/vehicles/train", (_req: Request, res: Response) => sendCache(res, "train"));

// SSE endpoint — clients subscribe to receive a ping whenever a group's cache updates
app.get("/api/events/:group", (req: Request, res: Response) => {
  const group = req.params.group as Group;
  if (group !== "bus" && group !== "train") {
    res.status(400).json({ error: "Unknown group" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send an initial ping so the client knows the connection is open
  res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);

  sseClients[group].add(res);

  req.on("close", () => {
    sseClients[group].delete(res);
  });
});

app.get("/api/health", (_req: Request, res: Response) => {
  const status: Record<string, unknown> = {};
  for (const group of ["bus", "train"] as Group[]) {
    const p = path.join(CACHE_DIR, `${group}.json`);
    if (fs.existsSync(p)) {
      const { updatedAt } = JSON.parse(fs.readFileSync(p, "utf8")) as CachePayload;
      status[group] = { updatedAt, ageSeconds: Math.round((Date.now() - updatedAt) / 1000) };
    } else {
      status[group] = null;
    }
  }
  res.json({ ok: true, cache: status });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  await loadProto();
  await pollAll();
  setInterval(pollAll, POLL_INTERVAL_MS);

  app.listen(SERVER_PORT, () => {
    console.log(`[server] Listening on http://localhost:${SERVER_PORT}`);
  });
}

start().catch(err => {
  console.error("[server] Fatal:", err);
  process.exit(1);
});
