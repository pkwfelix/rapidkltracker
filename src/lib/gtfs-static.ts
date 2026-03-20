import JSZip from "jszip";
import { openDB } from "idb";

export interface Stop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
}

export interface StopTime {
  trip_id: string;
  arrival_time: string;
  departure_time: string;
  stop_id: string;
  stop_sequence: number;
}

export interface Trip {
  trip_id: string;
  route_id: string;
  service_id: string;
  trip_headsign?: string;
  direction_id?: number;
}

export interface Route {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: number;
  route_color?: string;
  route_text_color?: string;
}

export interface GTFSData {
  stops: Map<string, Stop>;
  stopTimes: StopTime[];
  trips: Map<string, Trip>;
  routes: Map<string, Route>;
  stopsByName: Map<string, Stop[]>;
  tripsByStop: Map<string, StopTime[]>;
  tripStopTimesMap: Map<string, StopTime[]>;
  agency: string;
}

// In-memory cache for the current session (survives hot-reloads in dev)
const memoryCache = new Map<string, GTFSData>();

// ── IndexedDB cache (L2) ──────────────────────────────────────────────────────

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface GTFSCacheEntry {
  key: string;
  data: {
    stops: [string, Stop][];
    stopTimes: StopTime[];
    trips: [string, Trip][];
    routes: [string, Route][];
    stopsByName: [string, Stop[]][];
    tripsByStop: [string, StopTime[]][];
    tripStopTimesMap: [string, StopTime[]][];
    agency: string;
  };
  timestamp: number;
}

function openGTFSDB() {
  return openDB("rapidtracker-gtfs", 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("gtfs-cache")) {
        db.createObjectStore("gtfs-cache", { keyPath: "key" });
      }
    },
  });
}

async function idbGet(key: string): Promise<GTFSData | null> {
  try {
    const db = await openGTFSDB();
    const entry: GTFSCacheEntry | undefined = await db.get("gtfs-cache", key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > SESSION_TTL_MS) return null;
    return {
      stops:            new Map(entry.data.stops),
      stopTimes:        entry.data.stopTimes,
      trips:            new Map(entry.data.trips),
      routes:           new Map(entry.data.routes),
      stopsByName:      new Map(entry.data.stopsByName),
      tripsByStop:      new Map(entry.data.tripsByStop),
      tripStopTimesMap: new Map(entry.data.tripStopTimesMap),
      agency:           entry.data.agency,
    };
  } catch {
    return null;
  }
}

async function idbSet(key: string, data: GTFSData): Promise<void> {
  try {
    const db = await openGTFSDB();
    const entry: GTFSCacheEntry = {
      key,
      data: {
        stops:            Array.from(data.stops.entries()),
        stopTimes:        data.stopTimes,
        trips:            Array.from(data.trips.entries()),
        routes:           Array.from(data.routes.entries()),
        stopsByName:      Array.from(data.stopsByName.entries()),
        tripsByStop:      Array.from(data.tripsByStop.entries()),
        tripStopTimesMap: Array.from(data.tripStopTimesMap.entries()),
        agency:           data.agency,
      },
      timestamp: Date.now(),
    };
    await db.put("gtfs-cache", entry);
  } catch (err) {
    console.warn("[gtfs-static] IndexedDB write failed:", err);
  }
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values = splitCSVLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (values[i] ?? "").trim().replace(/^"|"$/g, "");
    });
    return obj;
  });
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function addSeconds(time: string, secs: number): string {
  const parts = time.split(":").map(Number);
  let total = parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0) + secs;
  const h = Math.floor(total / 3600);
  total %= 3600;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function getTodayActiveServiceIds(calendarText: string, calendarDatesText = ""): Set<string> {
  const active = new Set<string>();
  if (!calendarText) return active;

  const now = new Date();
  const dayIndex = now.getDay(); // 0=Sun,1=Mon,...,6=Sat
  const dayFields = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const todayField = dayFields[dayIndex];

  // YYYYMMDD format for date range check
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;

  parseCSV(calendarText).forEach((row) => {
    if (!row.service_id) return;
    if (row[todayField] !== "1") return;
    if (row.start_date && row.start_date > todayStr) return;
    if (row.end_date && row.end_date < todayStr) return;
    active.add(row.service_id);
  });

  if (calendarDatesText) {
    parseCSV(calendarDatesText).forEach((row) => {
      if (!row.service_id || row.date !== todayStr) return;
      if (row.exception_type === "1") active.add(row.service_id);
      else if (row.exception_type === "2") active.delete(row.service_id);
    });
  }

  return active;
}

async function fetchAndParse(url: string, agency: string): Promise<GTFSData> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch GTFS static: ${url}`);
  const buffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const readFile = async (name: string): Promise<string> => {
    const file = zip.file(name);
    if (!file) return "";
    return await file.async("string");
  };

  const [stopsText, stopTimesText, tripsText, routesText, freqText, calendarText, calendarDatesText] = await Promise.all([
    readFile("stops.txt"),
    readFile("stop_times.txt"),
    readFile("trips.txt"),
    readFile("routes.txt"),
    readFile("frequencies.txt"),
    readFile("calendar.txt"),
    readFile("calendar_dates.txt"),
  ]);

  const stops = new Map<string, Stop>();
  parseCSV(stopsText).forEach((row) => {
    if (row.stop_id) {
      stops.set(row.stop_id, {
        stop_id: row.stop_id,
        stop_name: row.stop_name || row.stop_id,
        stop_lat: parseFloat(row.stop_lat) || 0,
        stop_lon: parseFloat(row.stop_lon) || 0,
      });
    }
  });

  const trips = new Map<string, Trip>();
  parseCSV(tripsText).forEach((row) => {
    if (row.trip_id) {
      trips.set(row.trip_id, {
        trip_id: row.trip_id,
        route_id: row.route_id || "",
        service_id: row.service_id || "",
        trip_headsign: row.trip_headsign,
        direction_id: row.direction_id ? parseInt(row.direction_id) : undefined,
      });
    }
  });

  const routes = new Map<string, Route>();
  parseCSV(routesText).forEach((row) => {
    if (row.route_id) {
      routes.set(row.route_id, {
        route_id: row.route_id,
        route_short_name: row.route_short_name || "",
        route_long_name: row.route_long_name || "",
        route_type: parseInt(row.route_type) || 3,
        route_color: row.route_color || undefined,
        route_text_color: row.route_text_color || undefined,
      });
    }
  });

  // Parse base stop_times (template times for each trip pattern)
  const baseStopTimes = new Map<string, StopTime[]>();
  parseCSV(stopTimesText).forEach((row) => {
    if (row.trip_id && row.stop_id) {
      const st: StopTime = {
        trip_id: row.trip_id,
        arrival_time: row.arrival_time || "",
        departure_time: row.departure_time || "",
        stop_id: row.stop_id,
        stop_sequence: parseInt(row.stop_sequence) || 0,
      };
      if (!baseStopTimes.has(row.trip_id)) baseStopTimes.set(row.trip_id, []);
      baseStopTimes.get(row.trip_id)!.push(st);
    }
  });
  baseStopTimes.forEach((times) => times.sort((a, b) => a.stop_sequence - b.stop_sequence));

  // Expand frequencies.txt into concrete trip instances
  const stopTimes: StopTime[] = [];
  const todayServiceIds = getTodayActiveServiceIds(calendarText, calendarDatesText);

  if (freqText) {
    const freqRows = parseCSV(freqText);
    const freqByTrip = new Map<string, { start: string; end: string; headway: number }[]>();
    freqRows.forEach((row) => {
      if (!row.trip_id) return;
      if (!freqByTrip.has(row.trip_id)) freqByTrip.set(row.trip_id, []);
      freqByTrip.get(row.trip_id)!.push({
        start: row.start_time,
        end: row.end_time,
        headway: parseInt(row.headway_secs) || 300,
      });
    });

    freqByTrip.forEach((freqs, baseTripId) => {
      const trip = trips.get(baseTripId);
      if (!trip) return;
      // Only expand trips relevant to today's service
      if (todayServiceIds.size > 0 && !todayServiceIds.has(trip.service_id)) return;

      const basePattern = baseStopTimes.get(baseTripId);
      if (!basePattern || basePattern.length === 0) return;

      const baseFirstDep = timeToMinutes(basePattern[0].departure_time);

      freqs.forEach((freq) => {
        const startMins = timeToMinutes(freq.start);
        const endMins = timeToMinutes(freq.end);
        const headwayMins = freq.headway / 60;

        for (let depMins = startMins; depMins < endMins; depMins += headwayMins) {
          const offsetSecs = Math.round((depMins - baseFirstDep) * 60);
          const synthTripId = `${baseTripId}@${Math.round(depMins)}`;

          // Register synthetic trip
          if (!trips.has(synthTripId)) {
            trips.set(synthTripId, { ...trip, trip_id: synthTripId });
          }

          basePattern.forEach((st) => {
            stopTimes.push({
              trip_id: synthTripId,
              stop_id: st.stop_id,
              stop_sequence: st.stop_sequence,
              arrival_time: addSeconds(st.arrival_time, offsetSecs),
              departure_time: addSeconds(st.departure_time, offsetSecs),
            });
          });
        }
      });
    });
  }

  // For datasets without frequencies, use stop_times directly
  if (stopTimes.length === 0) {
    baseStopTimes.forEach((times, tripId) => {
      times.forEach((st) => stopTimes.push(st));
    });
  }

  const stopsByName = new Map<string, Stop[]>();
  stops.forEach((stop) => {
    const key = stop.stop_name.toLowerCase();
    if (!stopsByName.has(key)) stopsByName.set(key, []);
    stopsByName.get(key)!.push(stop);
  });

  const tripsByStop = new Map<string, StopTime[]>();
  const tripStopTimesMap = new Map<string, StopTime[]>();
  stopTimes.forEach((st) => {
    if (!tripsByStop.has(st.stop_id)) tripsByStop.set(st.stop_id, []);
    tripsByStop.get(st.stop_id)!.push(st);
    if (!tripStopTimesMap.has(st.trip_id)) tripStopTimesMap.set(st.trip_id, []);
    tripStopTimesMap.get(st.trip_id)!.push(st);
  });
  tripStopTimesMap.forEach((times) => times.sort((a, b) => a.stop_sequence - b.stop_sequence));

  return { stops, stopTimes, trips, routes, stopsByName, tripsByStop, tripStopTimesMap, agency };
}

export async function loadGTFSStatic(agency: string, category?: string): Promise<GTFSData> {
  const key = category ? `${agency}:${category}` : agency;

  // 1. In-memory cache (fastest — survives within the same page lifecycle)
  if (memoryCache.has(key)) return memoryCache.get(key)!;

  // 2. IndexedDB cache (persists across page reloads, 6h TTL)
  const cached = await idbGet(key);
  if (cached) {
    memoryCache.set(key, cached);
    return cached;
  }

  // 3. Network fetch + parse
  const url = category
    ? `https://api.data.gov.my/gtfs-static/${agency}?category=${category}`
    : `https://api.data.gov.my/gtfs-static/${agency}`;

  const data = await fetchAndParse(url, key);
  memoryCache.set(key, data);
  idbSet(key, data).catch(() => {}); // fire-and-forget
  return data;
}

export function searchStops(data: GTFSData[], query: string): Stop[] {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const results: Stop[] = [];
  const seen = new Set<string>();

  for (const d of data) {
    d.stops.forEach((stop) => {
      if (!seen.has(stop.stop_id) && stop.stop_name.toLowerCase().includes(q)) {
        seen.add(stop.stop_id);
        results.push(stop);
      }
    });
  }
  return results.slice(0, 20);
}

export function timeToMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  if (parts.length < 3) return NaN;
  return parts[0] * 60 + parts[1] + parts[2] / 60;
}

export function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
}
