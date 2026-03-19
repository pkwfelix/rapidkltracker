import { useState, useEffect, useCallback, useRef } from "react";
import type { GTFSData } from "../lib/gtfs-static";
import { loadGTFSStatic } from "../lib/gtfs-static";
import { fetchAllTrainPositions } from "../lib/gtfs-realtime";
import type { VehiclePosition } from "../lib/gtfs-realtime";
import { getArrivalsForStop } from "../lib/eta";
import type { ArrivalEstimate } from "../lib/eta";
import type { WatchedStation } from "../types";
import StationInput from "./StationInput";
import StationCard from "./StationCard";
import RefreshSpinner from "./RefreshSpinner";

const STORAGE_KEY = "rapidtracker:train-stations";
const REFRESH_INTERVAL = 10;

export default function TrainTracker() {
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
        const [rail, ktmb] = await Promise.allSettled([
          loadGTFSStatic("prasarana", "rapid-rail-kl"),
          loadGTFSStatic("ktmb"),
        ]);
        if (cancelled) return;
        const datasets: GTFSData[] = [];
        if (rail.status === "fulfilled") datasets.push(rail.value);
        if (ktmb.status === "fulfilled") datasets.push(ktmb.value);
        if (datasets.length === 0) {
          setStaticError("Failed to load train schedule data. Check your connection.");
        }
        datasetsRef.current = datasets;
        setGtfsDatasets(datasets);
      } catch (err) {
        if (!cancelled) setStaticError("Failed to load train schedule data.");
      } finally {
        if (!cancelled) setIsStaticLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Load watched stations from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setWatchedStations(JSON.parse(saved));
    } catch {}
  }, []);

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(watchedStations));
    } catch {}
  }, [watchedStations]);

  // Fetch realtime data and compute arrivals
  const refresh = useCallback(async () => {
    if (datasetsRef.current.length === 0) return;
    setIsRefreshing(true);
    try {
      const positions = await fetchAllTrainPositions();
      setVehiclePositions(positions);

      const map = new Map<string, ArrivalEstimate[]>();
      const stations = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as WatchedStation[];
      for (const station of stations) {
        const arrivals = getArrivalsForStop(station.stop_id, datasetsRef.current, positions);
        map.set(station.stop_id, arrivals);
      }
      setArrivalsMap(map);
    } catch (err) {
      console.error("Train refresh error:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Initial refresh after static data loads
  useEffect(() => {
    if (!isStaticLoading && gtfsDatasets.length > 0) {
      refresh();
    }
  }, [isStaticLoading, gtfsDatasets, refresh]);

  // Recompute arrivals when watched stations change
  useEffect(() => {
    if (datasetsRef.current.length === 0 || watchedStations.length === 0) return;
    const map = new Map<string, ArrivalEstimate[]>();
    for (const station of watchedStations) {
      const arrivals = getArrivalsForStop(station.stop_id, datasetsRef.current, vehiclePositions);
      map.set(station.stop_id, arrivals);
    }
    setArrivalsMap(map);
  }, [watchedStations, vehiclePositions]);

  const addStation = (station: WatchedStation) => {
    setWatchedStations((prev) => {
      if (prev.some((s) => s.stop_id === station.stop_id)) return prev;
      return [...prev, station];
    });
  };

  const removeStation = (stopId: string) => {
    setWatchedStations((prev) => prev.filter((s) => s.stop_id !== stopId));
  };

  return (
    <div>
      <div className="card-header">
        <div className="icon-box bg-s50">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="var(--c-txt-success)">
            <rect x="4" y="2" width="16" height="20" rx="2"/><line x1="4" y1="14" x2="20" y2="14"/><line x1="8" y1="22" x2="8" y2="18"/><line x1="16" y1="22" x2="16" y2="18"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-hi">Train Stations</div>
          <div className="text-xs text-lo">RapidKL Rail & KTMB</div>
        </div>
        <RefreshSpinner intervalSeconds={REFRESH_INTERVAL} onRefresh={refresh} isLoading={isRefreshing} />
      </div>

      <div className="card-body">
        {staticError && (
          <div className="bg-d50 text-d600 text-xs px-3 py-2 rounded-lg" style={{ border: "1px solid var(--c-border-d)" }}>
            {staticError}
          </div>
        )}
        <StationInput gtfsDatasets={gtfsDatasets} onAdd={addStation} placeholder="Search for a train station…" isLoading={isStaticLoading} />
        {watchedStations.length === 0 ? (
          <div className="text-center py-10 text-lo">
            <div className="text-4xl mb-2">🚆</div>
            <p className="text-sm">Add train stations above to track arrivals</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {watchedStations.map((station) => (
              <StationCard
                key={station.stop_id}
                station={station}
                arrivals={arrivalsMap.get(station.stop_id) ?? []}
                onRemove={removeStation}
                isLoading={isRefreshing && (arrivalsMap.get(station.stop_id)?.length ?? 0) === 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
