import type { NavigatorWaypoint, ScheduleNavigatorPayload } from "./aggregate";
import type { ProvenanceTag } from "./statusSummary";

export interface ScrubSnapshot {
  scrubIso: string;
  todayIso: string;
  /** True when scrub date is after calendar today (asOf). */
  isProjectedZone: boolean;
  /** Cumulative cascade slip for milestones that had started by scrubIso. */
  daysBehind: number;
  daysBehindProvenance: ProvenanceTag;
  complete: NavigatorWaypoint[];
  pending: NavigatorWaypoint[];
  /** Delays whose work had started by scrubIso (known by then). */
  delaysKnown: NavigatorWaypoint[];
  worstDelay: NavigatorWaypoint | null;
}

function parseMs(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

export function formatScrubDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Clamp ISO date to [start, max(plannedEnd, projectedEnd)]. */
export function clampScrubIso(
  iso: string,
  timeline: ScheduleNavigatorPayload["timeline"]
): string {
  const start = parseMs(timeline.start);
  const end = Math.max(
    parseMs(timeline.end),
    parseMs(timeline.projectedEnd)
  );
  const t = Math.min(Math.max(parseMs(iso), start), end);
  return new Date(t).toISOString().slice(0, 10);
}

/** Map 0–1 along the calendar axis to an ISO date. */
export function fractionToScrubIso(
  fraction: number,
  timeline: ScheduleNavigatorPayload["timeline"]
): string {
  const start = parseMs(timeline.start);
  const end = Math.max(
    parseMs(timeline.end),
    parseMs(timeline.projectedEnd)
  );
  const t = start + Math.min(1, Math.max(0, fraction)) * (end - start);
  return new Date(t).toISOString().slice(0, 10);
}

export function scrubIsoToFraction(
  iso: string,
  timeline: ScheduleNavigatorPayload["timeline"]
): number {
  const start = parseMs(timeline.start);
  const end = Math.max(
    parseMs(timeline.end),
    parseMs(timeline.projectedEnd)
  );
  const span = Math.max(end - start, 1);
  return (parseMs(iso) - start) / span;
}

/**
 * Facts as of an arbitrary scrub date — derived only from existing waypoint fields.
 * Path geometry is unaffected; this is inspection state only.
 */
export function buildScrubSnapshot(
  data: ScheduleNavigatorPayload,
  scrubIsoRaw: string
): ScrubSnapshot {
  const todayIso = data.timeline.asOf ?? data.timeline.start;
  const scrubIso = clampScrubIso(scrubIsoRaw, data.timeline);
  const scrubMs = parseMs(scrubIso);
  const todayMs = parseMs(todayIso);
  const isProjectedZone = scrubMs > todayMs;

  const started = data.waypoints.filter(
    (w) => parseMs(w.plannedStart) <= scrubMs
  );
  const daysBehind =
    started.length === 0
      ? 0
      : started.reduce((a, b) =>
          a.cascadeShiftAfter >= b.cascadeShiftAfter ? a : b
        ).cascadeShiftAfter;

  // Complete = projected end on or before scrub (cascade calendar)
  const complete = data.waypoints.filter(
    (w) => parseMs(w.projectedEnd) <= scrubMs
  );
  const pending = data.waypoints.filter(
    (w) => parseMs(w.projectedEnd) > scrubMs
  );

  const delaysKnown = data.waypoints.filter(
    (w) => w.localDelayDays > 0 && parseMs(w.plannedStart) <= scrubMs
  );
  const worstDelay =
    delaysKnown.length === 0
      ? null
      : delaysKnown.reduce((a, b) =>
          b.localDelayDays > a.localDelayDays ? b : a
        );

  return {
    scrubIso,
    todayIso,
    isProjectedZone,
    daysBehind,
    daysBehindProvenance: "DERIVED",
    complete,
    pending,
    delaysKnown,
    worstDelay,
  };
}
