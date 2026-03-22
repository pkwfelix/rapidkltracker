import { useState, useEffect, useCallback, useRef } from "react";
import type { GTFSData } from "../lib/gtfs-static";
import { loadGTFSStatic } from "../lib/gtfs-static";
import { getArrivalsForStop } from "../lib/eta";
import type { ArrivalEstimate } from "../lib/eta";
import type { VehiclePosition } from "../lib/gtfs-realtime";
import { subscribeToUpdates } from "../lib/gtfs-realtime";
import type { WatchedStation } from "../types";
import { REFRESH_INTERVAL_SECONDS } from "../lib/config";

export interface GTFSFeedRef {
  agency: string;
  category?: string;
}

export interface TrackerConfig {
  storageKey: string;
  feeds: GTFSFeedRef[];
  fetchPositions: () => Promise<VehiclePosition[]>;
  errorMessage: string;
  sseGroup: "bus" | "train";
}

export interface TrackerState {
  watchedStations: WatchedStation[];
  gtfsDatasets: GTFSData[];
  arrivalsMap: Map<string, ArrivalEstimate[]>;
  isStaticLoading: boolean;
  isRefreshing: boolean;
  staticError: string | null;
  refresh: () => Promise<void>;
  addStation: (station: WatchedStation) => void;
  removeStation: (stopId: string) => void;
  refreshIntervalSeconds: number;
}

export function useTracker(config: TrackerConfig): TrackerState {
  const { storageKey, feeds, fetchPositions, errorMessage, sseGroup } = config;

  const [watchedStations, setWatchedStations] = useState<WatchedStation[]>([]);
  const watchedStationsRef = useRef<WatchedStation[]>([]);
  const [gtfsDatasets, setGtfsDatasets] = useState<GTFSData[]>([]);

  // BUG-4: replaced vehiclePositions state with a ref so updating it after a
  // realtime fetch does NOT trigger a second re-render / second ETA computation.
  // All reads happen inside callbacks that already close over the ref, so no
  // stale-value issues arise.
  const vehiclePositionsRef = useRef<VehiclePosition[]>([]);

  const [arrivalsMap, setArrivalsMap] = useState<
    Map<string, ArrivalEstimate[]>
  >(new Map());
  const [isStaticLoading, setIsStaticLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [staticError, setStaticError] = useState<string | null>(null);
  const datasetsRef = useRef<GTFSData[]>([]);

  // Keep watchedStationsRef in sync with state
  useEffect(() => {
    watchedStationsRef.current = watchedStations;
  }, [watchedStations]);

  // Load GTFS static data on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsStaticLoading(true);
      setStaticError(null);
      try {
        const results = await Promise.allSettled(
          feeds.map((f) => loadGTFSStatic(f.agency, f.category)),
        );
        if (cancelled) return;
        const datasets: GTFSData[] = [];
        for (const r of results) {
          if (r.status === "fulfilled") datasets.push(r.value);
        }
        if (datasets.length === 0) setStaticError(errorMessage);
        datasetsRef.current = datasets;
        setGtfsDatasets(datasets);
      } catch {
        if (!cancelled) setStaticError(errorMessage);
      } finally {
        if (!cancelled) setIsStaticLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load watched stations from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setWatchedStations(JSON.parse(saved));
    } catch {
      // BUG-5: corrupt JSON is silently ignored AND the bad entry is removed so
      // it does not block every subsequent page load.
      console.warn(
        `[useTracker] Clearing corrupted localStorage entry for key: ${storageKey}`,
      );
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* storage unavailable */
      }
    }
  }, [storageKey]);

  // Persist watched stations to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(watchedStations));
    } catch {
      /* storage quota exceeded or unavailable */
    }
  }, [watchedStations, storageKey]);

  // Single, canonical computation path for arrivals.
  // Accepts the positions array explicitly so both the refresh path and the
  // watched-stations-changed path call exactly the same logic without duplicating it.
  const computeArrivals = useCallback((positions: VehiclePosition[]) => {
    const activeVehicles = new Map<string, VehiclePosition>();
    for (const vp of positions) {
      if (vp.tripId) activeVehicles.set(vp.tripId, vp);
    }
    const map = new Map<string, ArrivalEstimate[]>();
    for (const station of watchedStationsRef.current) {
      map.set(
        station.stop_id,
        getArrivalsForStop(
          station.stop_id,
          datasetsRef.current,
          activeVehicles,
        ),
      );
    }
    setArrivalsMap(map);
  }, []);

  // Fetch realtime vehicle positions and compute arrivals (single code path).
  const refresh = useCallback(async () => {
    if (datasetsRef.current.length === 0) return;
    setIsRefreshing(true);
    try {
      const positions = await fetchPositions();
      // Store in ref — does NOT trigger a re-render, preventing the duplicate
      // ETA computation that the old vehiclePositions state caused.
      vehiclePositionsRef.current = positions;
      computeArrivals(positions);
    } catch (err) {
      console.error("Tracker refresh error:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchPositions, computeArrivals]);

  // Initial refresh once static data has finished loading
  useEffect(() => {
    if (!isStaticLoading && gtfsDatasets.length > 0) refresh();
  }, [isStaticLoading, gtfsDatasets, refresh]);

  // SSE subscription — refresh immediately when the server publishes new data
  useEffect(() => {
    const unsubscribe = subscribeToUpdates(sseGroup, () => {
      refresh();
    });
    return unsubscribe;
  }, [sseGroup, refresh]);

  // Recompute arrivals when the watched-station list changes.
  // Reads vehicle positions from the ref so no stale data is used.
  useEffect(() => {
    if (datasetsRef.current.length === 0 || watchedStations.length === 0)
      return;
    computeArrivals(vehiclePositionsRef.current);
  }, [watchedStations, computeArrivals]);

  const addStation = useCallback((station: WatchedStation) => {
    setWatchedStations((prev) => {
      if (prev.some((s) => s.stop_id === station.stop_id)) return prev;
      return [...prev, station];
    });
  }, []);

  const removeStation = useCallback((stopId: string) => {
    setWatchedStations((prev) => prev.filter((s) => s.stop_id !== stopId));
  }, []);

  return {
    watchedStations,
    gtfsDatasets,
    arrivalsMap,
    isStaticLoading,
    isRefreshing,
    staticError,
    refresh,
    addStation,
    removeStation,
    refreshIntervalSeconds: REFRESH_INTERVAL_SECONDS,
  };
}
