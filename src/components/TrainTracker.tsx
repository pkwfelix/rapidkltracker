import { fetchAllTrainPositions } from "../lib/gtfs-realtime";
import { useTracker } from "../hooks/useTracker";
import StationInput from "./StationInput";
import StationCard from "./StationCard";
import RefreshSpinner from "./RefreshSpinner";

export default function TrainTracker() {
  const {
    watchedStations,
    gtfsDatasets,
    arrivalsMap,
    isStaticLoading,
    isRefreshing,
    staticError,
    refresh,
    addStation,
    removeStation,
    refreshIntervalSeconds,
  } = useTracker({
    storageKey: "rapidtracker:train-stations",
    feeds: [
      { agency: "prasarana", category: "rapid-rail-kl" },
      { agency: "ktmb" },
    ],
    fetchPositions: fetchAllTrainPositions,
    errorMessage: "Failed to load train schedule data. Check your connection.",
    sseGroup: "train",
  });

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
        <RefreshSpinner intervalSeconds={refreshIntervalSeconds} onRefresh={refresh} isLoading={isRefreshing} />
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
