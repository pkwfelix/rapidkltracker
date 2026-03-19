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
  const [gtfsDatasets, setGtfsDatasets] = useState<GTFSData[]>([]);
  const [vehiclePositions, setVehiclePositions] = useState<VehiclePosition[]>([]);
  const [arrivalsMap, setArrivalsMap] = useState<Map<string, ArrivalEstimate[]>>(new Map());
  const [isStaticLoading, setIsStaticLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [staticError, setStaticError] = useState<string | null>(null);
  const datasetsRef = useRef<GTFSData[]>([]);

  // Load GTFS static data on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsStaticLoading(true);
      setStaticError(null);
      try {
        const results = await Promise.allSettled(
          feeds.map((f) => loadGTFSStatic(f.agency, f.category))
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
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load watched stations from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setWatchedStations(JSON.parse(saved));
    } catch {}
  }, [storageKey]);

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(watchedStations));
    } catch {}
  }, [watchedStations, storageKey]);

  // Fetch realtime data and compute arrivals
  const refresh = useCallback(async () => {
    if (datasetsRef.current.length === 0) return;
    setIsRefreshing(true);
    try {
      const positions = await fetchPositions();
      setVehiclePositions(positions);
      const stations = JSON.parse(localStorage.getItem(storageKey) || "[]") as WatchedStation[];
      const map = new Map<string, ArrivalEstimate[]>();
      for (const station of stations) {
        map.set(station.stop_id, getArrivalsForStop(station.stop_id, datasetsRef.current, positions));
      }
      setArrivalsMap(map);
    } catch (err) {
      console.error("Tracker refresh error:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchPositions, storageKey]);

  // Initial refresh after static data loads
  useEffect(() => {
    if (!isStaticLoading && gtfsDatasets.length > 0) refresh();
  }, [isStaticLoading, gtfsDatasets, refresh]);

  // SSE subscription — refresh immediately when server pushes a cache update
  useEffect(() => {
    const unsubscribe = subscribeToUpdates(sseGroup, () => { refresh(); });
    return unsubscribe;
  }, [sseGroup, refresh]);

  // Recompute arrivals when watched stations change
  useEffect(() => {
    if (datasetsRef.current.length === 0 || watchedStations.length === 0) return;
    const map = new Map<string, ArrivalEstimate[]>();
    for (const station of watchedStations) {
      map.set(station.stop_id, getArrivalsForStop(station.stop_id, datasetsRef.current, vehiclePositions));
    }
    setArrivalsMap(map);
  }, [watchedStations, vehiclePositions]);

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
