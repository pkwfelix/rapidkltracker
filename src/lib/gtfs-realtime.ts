const _envBase = typeof import.meta !== "undefined"
  ? (import.meta as any).env?.PUBLIC_SERVER_BASE
  : undefined;
if (!_envBase) {
  console.warn(
    "[gtfs-realtime] PUBLIC_SERVER_BASE is not set. " +
    "Falling back to http://localhost:3001. " +
    "Set this variable for production deployments."
  );
}
const SERVER_BASE: string = _envBase ?? "http://localhost:3001";

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

interface ServerResponse {
  updatedAt: number;
  positions: VehiclePosition[];
}

async function fetchFromServer(group: "bus" | "train"): Promise<VehiclePosition[]> {
  const res = await fetch(`${SERVER_BASE}/api/vehicles/${group}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Server returned ${res.status} for ${group}`);
  const data: ServerResponse = await res.json();
  return data.positions;
}

export async function fetchAllBusPositions(): Promise<VehiclePosition[]> {
  return fetchFromServer("bus");
}

export async function fetchAllTrainPositions(): Promise<VehiclePosition[]> {
  return fetchFromServer("train");
}

/**
 * Subscribe to server-sent events for a group. The callback is invoked
 * each time the server writes a new cache entry for that group.
 * Returns a cleanup function to close the connection.
 * Falls back to a no-op if EventSource is unavailable.
 */
export function subscribeToUpdates(
  group: "bus" | "train",
  onUpdate: () => void
): () => void {
  if (typeof EventSource === "undefined") return () => {};

  const es = new EventSource(`${SERVER_BASE}/api/events/${group}`);

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      // Skip the initial connection ping
      if (data.connected) return;
      onUpdate();
    } catch {}
  };

  es.onerror = () => {
    // EventSource auto-reconnects; nothing to do here
  };

  return () => es.close();
}
