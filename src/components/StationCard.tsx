import type { ArrivalEstimate } from "../lib/eta";
import { formatMinutes } from "../lib/eta";
import type { WatchedStation } from "../types";

interface StationCardProps {
  station: WatchedStation;
  arrivals: ArrivalEstimate[];
  onRemove: (stopId: string) => void;
  isLoading: boolean;
}

export default function StationCard({
  station,
  arrivals,
  onRemove,
  isLoading,
}: StationCardProps) {
  return (
    <div
      style={{
        background: "var(--c-bg)",
        border: "1px solid var(--c-border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Station header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 14px",
          gap: 8,
          borderBottom: "1px solid var(--c-divider)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            className="text-sm font-semibold text-hi truncate"
            style={{ lineHeight: 1.3 }}
          >
            {station.stop_name}
          </p>
          <p
            className="text-xs text-lo"
            style={{ fontFamily: "monospace", marginTop: 1 }}
          >
            {station.stop_id}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRemove(station.stop_id)}
          aria-label={`Remove ${station.stop_name}`}
          className="station-remove-btn"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path d="M10.5 2.5L2.5 10.5M2.5 2.5l8 8" />
          </svg>
        </button>
      </div>

      {/* Arrivals list */}
      <div style={{ padding: "4px 14px 6px" }}>
        {isLoading && arrivals.length === 0 ? (
          <div
            style={{
              padding: "10px 0",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse"
                style={{
                  height: 32,
                  borderRadius: 6,
                  background: "var(--c-bg-washed)",
                  opacity: 1 - i * 0.25,
                }}
              />
            ))}
          </div>
        ) : arrivals.length === 0 ? (
          <div style={{ padding: "16px 0", textAlign: "center" }}>
            <p className="text-xs text-lo">
              No upcoming arrivals in the next 90 min
            </p>
          </div>
        ) : (
          arrivals.map((arrival, i) => (
            <ArrivalRow
              key={`${arrival.tripId}-${i}`}
              arrival={arrival}
              isLast={i === arrivals.length - 1}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ArrivalRow({
  arrival,
  isLast,
}: {
  arrival: ArrivalEstimate;
  isLast: boolean;
}) {
  const mins = arrival.estimatedMinutes;
  const urgency = mins <= 2 ? "arriving" : mins <= 5 ? "soon" : "normal";

  const etaColor =
    urgency === "arriving"
      ? "var(--c-txt-success)"
      : urgency === "soon"
        ? "var(--c-txt-warning)"
        : "var(--c-txt-hi)";

  return (
    <div
      className="flex items-center gap-3 py-2.5"
      style={{ borderBottom: isLast ? "none" : "1px solid var(--c-divider)" }}
    >
      <RouteBadge
        name={arrival.routeShortName}
        color={arrival.routeColor}
        textColor={arrival.routeTextColor}
      />

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-hi truncate leading-tight">
          {arrival.headsign}
        </p>
        <p className="text-[11px] text-lo mt-0.5">
          {formatScheduledTime(arrival.scheduledArrival)}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p
          className="text-sm font-bold tabular-nums leading-tight"
          style={{ color: etaColor }}
        >
          {formatMinutes(mins)}
        </p>
        {arrival.isRealtime && (
          <span
            className="inline-flex items-center gap-1 animate-pulse"
            style={{
              fontSize: "10px",
              fontWeight: 500,
              color: "var(--c-txt-primary)",
              marginTop: 2,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--c-txt-primary)",
                display: "inline-block",
              }}
            />
            Live
          </span>
        )}
      </div>
    </div>
  );
}

function RouteBadge({
  name,
  color,
  textColor,
}: {
  name: string;
  color?: string;
  textColor?: string;
}) {
  const bg = color ? `#${color}` : "var(--c-bg-p100)";
  const fg = textColor ? `#${textColor}` : "var(--c-txt-primary)";
  return (
    <span
      className="inline-flex items-center justify-center rounded-md text-[11px] font-bold leading-none shrink-0"
      style={{
        backgroundColor: bg,
        color: fg,
        minWidth: "2.75rem",
        padding: "3px 6px",
      }}
    >
      {name || "—"}
    </span>
  );
}

function formatScheduledTime(time: string): string {
  if (!time) return "";
  const parts = time.split(":");
  if (parts.length < 2) return time;
  // Normalise overday GTFS times (24:xx, 25:xx …) before deriving AM/PM.
  // Without this, 25:30 (= 1:30 am) would incorrectly read as "1:30 pm"
  // because 25 >= 12 is true before the modulo is applied.
  const h24 = parseInt(parts[0]) % 24;
  const suffix = h24 >= 12 ? "pm" : "am";
  const h12 = h24 % 12 || 12;
  return `${h12}:${parts[1]} ${suffix}`;
}
