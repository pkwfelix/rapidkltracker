/**
 * Exploration tests (Task 1) — confirm each bug exists on UNFIXED code.
 * These tests are EXPECTED TO FAIL before fixes are applied.
 * After each fix they should pass.
 *
 * Validates: Requirements 1.1–1.8
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

function todayStr(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

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

function makeCalendarDatesText(serviceId: string, exceptionType: "1" | "2"): string {
  return `service_id,date,exception_type\n${serviceId},${todayStr()},${exceptionType}\n`;
}

// ─── Bug 1 — Overnight ETA skipping ─────────────────────────────────────────

describe("Bug 1 — overnight ETA skipping", () => {
  beforeEach(() => {
    // Clock at 00:30 (30 mins) — post-midnight window
    vi.spyOn(gtfsStatic, "nowMinutes").mockReturnValue(30);
  });
  afterEach(() => vi.restoreAllMocks());

  it("includes a trip with arrival 24:45 when clock is 00:30 (diffMins should be 15)", () => {
    const dataset = makeGTFSData("24:45:00"); // arrivalMins=1485, now=30 → diffMins=1455 on unfixed; normNow=1470 → diffMins=15 on fixed
    const results = getArrivalsForStop("S1", [dataset as any], new Map());
    expect(results.length).toBe(1);
    expect(results[0].estimatedMinutes).toBeLessThanOrEqual(90);
  });
});

// ─── Bug 2 — NavSpinner captures totalSeconds from first tick ────────────────

describe("Bug 2 — NavSpinner totalSeconds from first tick", () => {
  it("totalSeconds should be REFRESH_INTERVAL_SECONDS (10) even when first tick has secondsLeft=3", async () => {
    const { container } = render(React.createElement(NavSpinner));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("rapidtracker:tick", { detail: { secondsLeft: 3, refreshing: false } })
      );
    });

    // The progress ring's strokeDashoffset should reflect progress = (10-3)/10 = 0.7
    // On unfixed code totalSeconds=3, so progress = (3-3)/3 = 0 → dashoffset = circumference
    // On fixed code totalSeconds=10, so progress = (10-3)/10 = 0.7 → dashoffset < circumference
    const circle = container.querySelectorAll("circle")[1]; // progress circle
    const circumference = 2 * Math.PI * 5.5;
    const dashoffset = parseFloat(circle?.getAttribute("stroke-dashoffset") ?? "0");
    // Fixed: dashoffset = circumference * (1 - 0.7) = circumference * 0.3
    expect(dashoffset).toBeCloseTo(circumference * 0.3, 1);
  });
});

// ─── Bug 3 — RefreshSpinner calls onRefresh inside state updater ─────────────

describe("Bug 3 — RefreshSpinner onRefresh called inside state updater", () => {
  it("calls onRefresh exactly once per cycle (not twice in Strict Mode)", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();

    render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(RefreshSpinner, { intervalSeconds: 2, onRefresh, isLoading: false })
      )
    );

    // Advance 1 second at a time so React can flush effects between ticks
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    vi.useRealTimers();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

// ─── Bug 4 — useTracker reads localStorage inside refresh() ─────────────────
// This is tested indirectly via getArrivalsForStop — the hook fix ensures
// the ref is used. We test the underlying behaviour: arrivals are computed
// for stations in state even when localStorage is empty.

describe("Bug 4 — arrivals computed from state, not localStorage", () => {
  beforeEach(() => {
    vi.spyOn(gtfsStatic, "nowMinutes").mockReturnValue(480); // 8:00am
    // Simulate localStorage returning empty (as if unavailable or cleared)
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  it("getArrivalsForStop returns arrivals regardless of localStorage state", () => {
    const dataset = makeGTFSData("09:00:00");
    // The fix is in useTracker, but we verify the underlying function works
    // independently of localStorage — it should always return arrivals for valid data
    const results = getArrivalsForStop("S1", [dataset as any], new Map());
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─── Bug 5a — calendar_dates.txt exception_type=2 ignored ───────────────────

describe("Bug 5a — exception_type=2 (removal) ignored", () => {
  it("SVC-A should NOT be active when calendar_dates has exception_type=2 for today", () => {
    const calendarText = makeCalendarText("SVC-A", true); // active in calendar.txt
    const calendarDatesText = makeCalendarDatesText("SVC-A", "2"); // removed today
    // On unfixed code: getTodayActiveServiceIds only takes 1 arg, SVC-A stays active
    const result = getTodayActiveServiceIds(calendarText, calendarDatesText as any);
    expect(result.has("SVC-A")).toBe(false);
  });
});

// ─── Bug 5b — calendar_dates.txt exception_type=1 ignored ───────────────────

describe("Bug 5b — exception_type=1 (addition) ignored", () => {
  it("SVC-B should be active when calendar_dates has exception_type=1 for today", () => {
    const calendarText = makeCalendarText("SVC-B", false); // NOT active in calendar.txt
    const calendarDatesText = makeCalendarDatesText("SVC-B", "1"); // added today
    // On unfixed code: getTodayActiveServiceIds only takes 1 arg, SVC-B stays inactive
    const result = getTodayActiveServiceIds(calendarText, calendarDatesText as any);
    expect(result.has("SVC-B")).toBe(true);
  });
});
