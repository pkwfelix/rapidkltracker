import type { VehiclePosition } from "../shared/types.js";

// VehiclePosition is the single source of truth in shared/types.ts so the
// server and client never drift out of sync.
export type { VehiclePosition };

export interface CachePayload {
  updatedAt: number;
  positions: VehiclePosition[];
}

export type Group = "bus" | "train";
