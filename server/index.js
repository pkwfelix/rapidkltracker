import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import protobuf from "protobufjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "cache");
const PROTO_PATH = path.join(__dirname, "..", "public", "gtfs-realtime.proto");
const PORT = 3001;
const POLL_INTERVAL_MS = 30_000;

const FEEDS = {
  bus: [
    { key: "rapid-bus-kl",      url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl" },
    { key: "rapid-bus-mrtfeeder", url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder" },
  ],
  train: [
    { key: "ktmb", url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb" },
  ],
};

// Ensure cache dir exists
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Load proto once
let FeedMessage = null;
async function loadProto() {
  const root = await protobuf.load(PROTO_PATH);
  FeedMessage = root.lookupType("transit_realtime.FeedMessage");
  console.log("[proto] Loaded gtfs-realtime.proto");
}

async function fetchFeed(key, url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${key}`);
  const buf = await res.arrayBuffer();
  const msg = FeedMessage.decode(new Uint8Array(buf));
  const obj = FeedMessage.toObject(msg, { longs: Number, enums: String });

  const positions = [];
  for (const entity of obj.entity || []) {
    const v = entity.vehicle;
    if (!v) continue;
    const trip = v.trip || {};
    const pos  = v.position || {};
    const veh  = v.vehicle || {};
    if (!pos.latitude && !pos.longitude) continue;
    positions.push({
      vehicleId:           veh.id || entity.id || "",
      tripId:              trip.tripId || trip.trip_id || "",
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

async function pollGroup(group) {
  const feeds = FEEDS[group];
  const results = await Promise.allSettled(feeds.map(f => fetchFeed(f.key, f.url)));

  const positions = results.flatMap((r, i) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[poll] ${feeds[i].key} failed: ${r.reason?.message}`);
    return [];
  });

  const payload = { updatedAt: Date.now(), positions };
  const cachePath = path.join(CACHE_DIR, `${group}.json`);
  fs.writeFileSync(cachePath, JSON.stringify(payload));
  console.log(`[poll] ${group}: ${positions.length} vehicles — ${new Date().toISOString()}`);
}

async function pollAll() {
  await Promise.allSettled([pollGroup("bus"), pollGroup("train")]);
}

// ── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors());

function sendCache(res, group) {
  const cachePath = path.join(CACHE_DIR, `${group}.json`);
  if (!fs.existsSync(cachePath)) {
    return res.status(503).json({ error: "Cache not ready yet" });
  }
  const raw = fs.readFileSync(cachePath, "utf8");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.send(raw);
}

app.get("/api/vehicles/bus",   (_req, res) => sendCache(res, "bus"));
app.get("/api/vehicles/train", (_req, res) => sendCache(res, "train"));

app.get("/api/health", (_req, res) => {
  const status = {};
  for (const group of ["bus", "train"]) {
    const p = path.join(CACHE_DIR, `${group}.json`);
    if (fs.existsSync(p)) {
      const { updatedAt } = JSON.parse(fs.readFileSync(p, "utf8"));
      status[group] = { updatedAt, ageSeconds: Math.round((Date.now() - updatedAt) / 1000) };
    } else {
      status[group] = null;
    }
  }
  res.json({ ok: true, cache: status });
});

// ── Boot ─────────────────────────────────────────────────────────────────────

async function start() {
  await loadProto();
  await pollAll();                                  // first fetch immediately
  setInterval(pollAll, POLL_INTERVAL_MS);

  app.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error("[server] Fatal:", err);
  process.exit(1);
});
