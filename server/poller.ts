import path from "path";
import { fileURLToPath } from "url";
import protobuf from "protobufjs";
import type { Response } from "express";
import type { Group, VehiclePosition, CachePayload } from "./types.js";
import { writeCache } from "./cache.js";

const PROTO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "gtfs-realtime.proto");

const FEEDS: Record<Group, { key: string; url: string }[]> = {
  bus: [
    { key: "rapid-bus-kl",        url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl" },
    { key: "rapid-bus-mrtfeeder", url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder" },
  ],
  train: [
    { key: "ktmb", url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb" },
  ],
};

export const sseClients: Record<Group, Set<Response>> = { bus: new Set(), train: new Set() };

let FeedMessage: protobuf.Type | null = null;

export async function loadProto(): Promise<void> {
  const root = await protobuf.load(PROTO_PATH);
  FeedMessage = root.lookupType("transit_realtime.FeedMessage");
  console.log("[proto] Loaded gtfs-realtime.proto");
}

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
  await writeCache(group, payload);
  console.log(`[poll] ${group}: ${positions.length} vehicles — ${new Date().toISOString()}`);

  const event = `data: ${JSON.stringify({ updatedAt: payload.updatedAt })}\n\n`;
  for (const client of sseClients[group]) {
    try { client.write(event); } catch { sseClients[group].delete(client); }
  }
}

export async function pollAll(): Promise<void> {
  await Promise.allSettled([pollGroup("bus"), pollGroup("train")]);
}
