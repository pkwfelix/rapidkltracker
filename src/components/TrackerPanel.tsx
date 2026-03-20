import type { ReactNode } from "react";
import type { TrackerConfig } from "../hooks/useTracker";
import { useTracker } from "../hooks/useTracker";
import { fetchAllBusPositions, fetchAllTrainPositions } from "../lib/gtfs-realtime";
import StationInput from "./StationInput";
import StationCard from "./StationCard";
import RefreshSpinner from "./RefreshSpinner";

export interface TrackerDisplay {
  icon: ReactNode;
  iconBgClass: string;
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  emptyEmoji: string;
  emptyMessage: string;
}

export type TrackerVariant = "bus" | "train";

const CONFIGS: Record<TrackerVariant, TrackerConfig> = {
  bus: {
    storageKey: "rapidtracker:bus-stations",
    feeds: [
      { agency: "prasarana", category: "rapid-bus-kl" },
      { agency: "prasarana", category: "rapid-bus-mrtfeeder" },
    ],
    fetchPositions: fetchAllBusPositions,
    errorMessage: "Failed to load bus schedule data. Check your connection.",
    sseGroup: "bus",
  },
  train: {
    storageKey: "rapidtracker:train-stations",
    feeds: [
      { agency: "prasarana", category: "rapid-rail-kl" },
      { agency: "ktmb" },
    ],
    fetchPositions: fetchAllTrainPositions,
    errorMessage: "Failed to load train schedule data. Check your connection.",
    sseGroup: "train",
  },
};

const DISPLAYS: Record<TrackerVariant, TrackerDisplay> = {
  bus: {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="var(--c-txt-primary)">
        <rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
    ),
    iconBgClass: "bg-p50",
    title: "Bus Stops",
    subtitle: "RapidKL & MRT Feeder",
    searchPlaceholder: "Search for a bus stop…",
    emptyEmoji: "🚌",
    emptyMessage: "Add bus stops above to track arrivals",
  },
  train: {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="var(--c-txt-success)">
        <rect x="4" y="2" width="16" height="20" rx="2"/><line x1="4" y1="14" x2="20" y2="14"/><line x1="8" y1="22" x2="8" y2="18"/><line x1="16" y1="22" x2="16" y2="18"/>
      </svg>
    ),
    iconBgClass: "bg-s50",
    title: "Train Stations",
    subtitle: "RapidKL Rail & KTMB",
    searchPlaceholder: "Search for a train station…",
    emptyEmoji: "🚆",
    emptyMessage: "Add train stations above to track arrivals",
  },
};

export interface TrackerPanelProps {
  variant: TrackerVariant;
}

export default function TrackerPanel({ variant }: TrackerPanelProps) {
  const config = CONFIGS[variant];
  const display = DISPLAYS[variant];

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
  } = useTracker(config);

  return (
    <div>
      <div className="card-header">
        <div className={`icon-box ${display.iconBgClass}`}>
          {display.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-hi">{display.title}</div>
          <div className="text-xs text-lo">{display.subtitle}</div>
        </div>
        <RefreshSpinner intervalSeconds={refreshIntervalSeconds} onRefresh={refresh} isLoading={isRefreshing} />
      </div>

      <div className="card-body">
        {staticError && (
          <div className="bg-d50 text-d600 text-xs px-3 py-2 rounded-lg" style={{ border: "1px solid var(--c-border-d)" }}>
            {staticError}
          </div>
        )}
        <StationInput gtfsDatasets={gtfsDatasets} onAdd={addStation} placeholder={display.searchPlaceholder} isLoading={isStaticLoading} />
        {watchedStations.length === 0 ? (
          <div className="text-center py-10 text-lo">
            <div className="text-4xl mb-2">{display.emptyEmoji}</div>
            <p className="text-sm">{display.emptyMessage}</p>
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
