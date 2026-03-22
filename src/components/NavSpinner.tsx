import { useState, useEffect } from "react";
import { REFRESH_INTERVAL_SECONDS } from "../lib/config";

export default function NavSpinner() {
  const [refreshing, setRefreshing] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const onTick = (e: Event) => {
      const ev = e as CustomEvent<{ secondsLeft: number; refreshing: boolean }>;
      setSecondsLeft(ev.detail.secondsLeft);
      setRefreshing(ev.detail.refreshing);
    };
    window.addEventListener("rapidtracker:tick", onTick);
    return () => window.removeEventListener("rapidtracker:tick", onTick);
  }, []);

  // Calculate progress for the circular ring
  const progress =
    secondsLeft !== null
      ? (REFRESH_INTERVAL_SECONDS - secondsLeft) / REFRESH_INTERVAL_SECONDS
      : 0;
  const circumference = 2 * Math.PI * 5.5; // radius = 5.5
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div className="flex items-center gap-1.5">
      {secondsLeft !== null && (
        <span
          style={{
            fontSize: "0.75rem",
            color: "var(--c-txt-lo)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {refreshing ? "Refreshing…" : `${secondsLeft}s`}
        </span>
      )}
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        className={refreshing ? "animate-spin" : ""}
        aria-hidden="true"
      >
        {/* Background circle */}
        <circle
          cx="7"
          cy="7"
          r="5.5"
          stroke="var(--c-border)"
          strokeWidth="1.5"
          fill="none"
        />
        {/* Progress circle */}
        <circle
          cx="7"
          cy="7"
          r="5.5"
          stroke="var(--c-txt-primary)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          transform="rotate(-90 7 7)"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          style={{
            transition: refreshing ? "none" : "stroke-dashoffset 1s linear",
          }}
        />
      </svg>
    </div>
  );
}
