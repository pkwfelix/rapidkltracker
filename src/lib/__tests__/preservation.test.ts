/**
 * Preservation tests (Task 2) — verify existing CORRECT behaviour is unchanged.
 * These tests MUST PASS on unfixed code — they establish the baseline.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import * as gtfsStatic from "../gtfs-static";
import { getArrivalsForStop } from "../eta";
import { getTodayActiveServiceIds } from "../gtfs-static";
import NavSpinner from "../../components/NavSpinner";
import RefreshSpinner from "../../components/RefreshSpinner";

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal GTFSData with a single stop time for stopId "S1" */
function makeGTFSData(arrivalTime: string) {
  const stopTime = {
    trip_id: "T1",
    arrival_time: arrivalTime,
    departure_time: arrivalTime,
    stop_id: "S1",
    stop_sequence: 1,
  };
  const trip = { trip_id: "T1", route_id: "R1", service_id: "SVC1" };
  const route = {
    route_id: "R1",
    route_short_name: "1",
    route_long_name: "Route One",
    route_type: 3,
  };
  return {
    stops: new Map([["S1", { stop_id: "S1", stop_name: "Stop 1", stop_lat: 0, stop_lon: 0 }]]),
    stopTimes: [stopTime],
    trips: new Map([["T1", trip]]),
    routes: new Map([["R1", route]]),
    stopsByName: new Map(),
    tripsByStop: new Map([["S1", [stopTime]]]),
    tripStopTimesMap: new Map([["T1", [stopTime]]]),
    agency: "test",
  };
}

/** Build a calendar.txt CSV string for a given service, active or not for today */
function makeCalendarText(serviceId: string, activeToday: boolean): string {
  const now = new Date();
  const dayFields = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const todayField = dayFields[now.getDay()];
  const pad = (n: number) => String(n).padStart(2, "0");
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const startDate = `${yesterday.getFullYear()}${pad(yesterday.getMonth() + 1)}${pad(yesterday.getDate())}`;
  const endDate = `${tomorrow.getFullYear()}${pad(tomorrow.getMonth() + 1)}${pad(tomorrow.getDate())}`;
  const cols = dayFields.map((f) => (f === todayField ? (activeToday ? "1" : "0") : "0")).join(",");
  return `service_id,sunday,monday,tuesday,wednesday,thursday,friday,saturday,start_date,end_date\n${serviceId},${cols},${startDate},${endDate}\n`;
}

// ─── Bug 1 preservation — Normal-hours ETA unchanged ────────────────────────
// Validates: Requirements 3.1

describe("Bug 1 preservation — normal-hours ETA unchanged", () => {
  beforeEach(() => {
    vi.spyOn(gtfsStatic, "nowMinutes").mockReturnValue(480); // 8:00am = 480 mins
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes a trip arriving 30 mins from now (08:00 now, 08:30 arrival, diffMins=30)", () => {
    const dataset = makeGTFSData("08:30:00"); // arrivalMins=510, diffMins=30 < 90
    const results = getArrivalsForStop("S1", [dataset as any], new Map());
    expect(results.length).toBe(1);
    expect(results[0].estimatedMinutes).toBe(30);
  });

  it("excludes a trip arriving 150 mins from now (08:00 now, 10:30 arrival — beyond 90-min lookahead)", () => {
    const dataset = makeGTFSData("10:30:00"); // arrivalMins=630, diffMins=150 > 90
    const results = getArrivalsForStop("S1", [dataset as any], new Map());
    expect(results.length).toBe(0);
  });

  it("includes a trip arriving 60 mins from now (08:00 now, 09:00 arrival, diffMins=60)", () => {
    const dataset = makeGTFSData("09:00:00"); // arrivalMins=540, diffMins=60 < 90
    const results = getArrivalsForStop("S1", [dataset as any], new Map());
    expect(results.length).toBe(1);
    expect(results[0].estimatedMinutes).toBe(60);
  });
});

// ─── Bug 2 preservation — NavSpinner tick updates ───────────────────────────
// Validates: Requirements 3.2

describe("Bug 2 preservation — NavSpinner tick updates", () => {
  it("updates secondsLeft display when a rapidtracker:tick event is dispatched with secondsLeft=8", async () => {
    const { getByText } = render(React.createElement(NavSpinner));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("rapidtracker:tick", { detail: { secondsLeft: 8, refreshing: false } })
      );
    });

    expect(getByText("8s")).toBeInTheDocument();
  });

  it("shows 'Refreshing…' when a rapidtracker:tick event has refreshing=true", async () => {
    const { getByText } = render(React.createElement(NavSpinner));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("rapidtracker:tick", { detail: { secondsLeft: 5, refreshing: true } })
      );
    });

    expect(getByText("Refreshing…")).toBeInTheDocument();
  });
});

// ─── Bug 3 preservation — RefreshSpinner countdown emits tick events ─────────
// Validates: Requirements 3.3

describe("Bug 3 preservation — RefreshSpinner countdown", () => {
  it("emits a rapidtracker:tick event with secondsLeft=2 after 1 second when intervalSeconds=3", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();

    const dispatched: CustomEvent[] = [];
    const listener = (e: Event) => dispatched.push(e as CustomEvent);
    window.addEventListener("rapidtracker:tick", listener);

    render(
      React.createElement(RefreshSpinner, { intervalSeconds: 3, onRefresh, isLoading: false })
    );

    // Advance 1 second — counter goes from 3 → 2
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    window.removeEventListener("rapidtracker:tick", listener);
    vi.useRealTimers();

    const tickWith2 = dispatched.find((e) => e.detail?.secondsLeft === 2);
    expect(tickWith2).toBeDefined();
  });
});

// ─── Bug 4 preservation — getArrivalsForStop with consistent data ────────────
// Validates: Requirements 3.4

describe("Bug 4 preservation — arrivals returned correctly when data is consistent", () => {
  beforeEach(() => {
    vi.spyOn(gtfsStatic, "nowMinutes").mockReturnValue(480); // 8:00am
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns arrivals for a stop time of 09:00 when nowMinutes=480 (diffMins=60)", () => {
    const dataset = makeGTFSData("09:00:00");
    const results = getArrivalsForStop("S1", [dataset as any], new Map());
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].estimatedMinutes).toBe(60);
  });
});

// ─── Bug 5 preservation — calendar.txt-only services ────────────────────────
// Validates: Requirements 3.5, 3.6

describe("Bug 5 preservation — calendar.txt-only services", () => {
  it("includes SVC-X when it is active for today in calendar.txt (no calendarDates override)", () => {
    const calendarText = makeCalendarText("SVC-X", true);
    const result = getTodayActiveServiceIds(calendarText);
    expect(result.has("SVC-X")).toBe(true);
  });

  it("excludes SVC-Y when it is NOT active for today in calendar.txt (no calendarDates override)", () => {
    const calendarText = makeCalendarText("SVC-Y", false);
    const result = getTodayActiveServiceIds(calendarText);
    expect(result.has("SVC-Y")).toBe(false);
  });
});
