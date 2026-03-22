/**
 * Shared types used by both the Express server (server/) and the Astro/React
 * client (src/). Keeping VehiclePosition here eliminates the duplicate
 * interface definitions that previously existed in:
 *   - server/types.ts
 *   - src/lib/gtfs-realtime.ts
 */

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
