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

export type Group = "bus" | "train";
