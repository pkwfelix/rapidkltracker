import type { GTFSData, Stop } from "./gtfs-static";
import { timeToMinutes, nowMinutes } from "./gtfs-static";
import type { VehiclePosition } from "./gtfs-realtime";
import { LOOKAHEAD_MINUTES, MAX_ARRIVALS } from "./config";

export interface ArrivalEstimate {
  tripId: string;
  routeShortName: string;
  routeLongName: string;
  headsign: string;
  scheduledArrival: string;
  estimatedMinutes: number;
  isRealtime: boolean;
  vehicleId?: string;
  routeColor?: string;
  routeTextColor?: string;
}

export interface StopArrival {
  stop: Stop;
  arrivals: ArrivalEstimate[];
  lastUpdated: Date;
}

export function getArrivalsForStop(
  stopId: string,
  gtfsDatasets: GTFSData[],
  vehiclePositions: VehiclePosition[]
): ArrivalEstimate[] {
  const now = nowMinutes();
  // Normalise for overnight GTFS times (24:xx–27:xx): if clock is 00:00–03:59,
  // treat it as 24:xx–27:xx so diffMins stays small and positive.
  const normNow = now < 240 ? now + 1440 : now;
  const arrivals: ArrivalEstimate[] = [];

  // Build a map of tripId -> active vehicle
  const activeVehicles = new Map<string, VehiclePosition>();
  for (const vp of vehiclePositions) {
    if (vp.tripId) {
      activeVehicles.set(vp.tripId, vp);
    }
  }

  for (const dataset of gtfsDatasets) {
    const stopTimes = dataset.tripsByStop.get(stopId);
    if (!stopTimes) continue;

    for (const st of stopTimes) {
      const arrivalMins = timeToMinutes(st.arrival_time);
      if (isNaN(arrivalMins)) continue;

      // Only show upcoming arrivals within the lookahead window
      // Handle overnight times (e.g. 25:30 = 1:30am next day)
      let diffMins = arrivalMins - normNow;
      if (diffMins < -5) {
        // If negative by small margin, skip
        continue;
      }
      if (diffMins > LOOKAHEAD_MINUTES) continue;

      const trip = dataset.trips.get(st.trip_id);
      if (!trip) continue;

      const route = dataset.routes.get(trip.route_id);
      const routeShortName = route?.route_short_name || trip.route_id || "";
      const routeLongName = route?.route_long_name || "";
      const headsign = trip.trip_headsign || routeLongName || routeShortName;
      const routeColor = route?.route_color;
      const routeTextColor = route?.route_text_color;

      // Check if this trip has an active vehicle
      const activeVehicle = activeVehicles.get(st.trip_id);
      let estimatedMinutes = Math.round(diffMins);
      let isRealtime = false;

      if (activeVehicle) {
        // Vehicle is active: estimate remaining time to this stop
        const vehicleSequence = activeVehicle.currentStopSequence;
        if (vehicleSequence !== undefined && vehicleSequence < st.stop_sequence) {
          // Vehicle hasn't reached this stop yet — use schedule time adjusted by vehicle progress
          const tripStops = dataset.tripStopTimesMap.get(st.trip_id) ?? [];
          const vehicleCurrentSt = tripStops.find(
            (ts) => ts.stop_sequence === vehicleSequence
          );
          if (vehicleCurrentSt) {
            const vehicleTimeMins = timeToMinutes(vehicleCurrentSt.departure_time);
            if (!isNaN(vehicleTimeMins)) {
              // Time from vehicle's current position to our stop (schedule-based)
              const remainingBySchedule = arrivalMins - vehicleTimeMins;
              // Current clock time difference from vehicle's scheduled position
              const vehicleDelay = now - vehicleTimeMins;
              // Estimate: remaining schedule time adjusted for current delay
              estimatedMinutes = Math.max(0, Math.round(remainingBySchedule - vehicleDelay));
              isRealtime = true;
            }
          }
        } else if (vehicleSequence !== undefined && vehicleSequence >= st.stop_sequence) {
          // Vehicle has already passed this stop — skip
          continue;
        }

        if (activeVehicle.timestamp) {
          isRealtime = true;
        }
      }

      arrivals.push({
        tripId: st.trip_id,
        routeShortName,
        routeLongName,
        headsign,
        scheduledArrival: st.arrival_time,
        estimatedMinutes,
        isRealtime,
        vehicleId: activeVehicle?.vehicleId,
        routeColor,
        routeTextColor,
      });
    }
  }

  // Sort by estimated arrival time and deduplicate by route
  arrivals.sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);

  // Deduplicate: keep one entry per route per ~5-minute window
  const deduped: ArrivalEstimate[] = [];
  const seen = new Set<string>();
  for (const a of arrivals) {
    const key = `${a.routeShortName}:${Math.floor(a.estimatedMinutes / 5)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(a);
    }
    if (deduped.length >= MAX_ARRIVALS) break;
  }

  return deduped;
}

export function formatMinutes(mins: number): string {
  if (mins <= 0) return "Arriving";
  if (mins === 1) return "1 min";
  if (mins < 60) return `${mins} mins`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
