// Vehicle positions are now fetched from the local Node server (server/index.js)
// which polls api.data.gov.my every 30s and caches results as JSON.
// Server runs on port 3001 alongside Astro on 4321.
const SERVER_BASE = "http://localhost:3001";

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
