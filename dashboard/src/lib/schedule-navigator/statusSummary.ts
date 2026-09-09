import type { NavigatorWaypoint, ScheduleNavigatorPayload } from "./aggregate";

export type ProvenanceTag = "FORGED" | "REAL" | "DERIVED";

export interface StatusSummary {
  projectName: string;
  asOf: string | null;
  /** Days behind (positive) or ahead (negative) at asOf from cascaded local delays. */
  daysBehind: number | null;
  daysBehindProvenance: ProvenanceTag;
  daysBehindNote: string;
  /** Not available on this payload — no project % complete field. */
  percentComplete: null;
  percentCompleteNote: string;
  nextMilestone: NavigatorWaypoint | null;
  worstUnresolvedDelay: NavigatorWaypoint | null;
}

function parseMs(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

/**
 * Derive glanceable project status from navigator payload.
 * Slip uses cascade of delays known by asOf (DERIVED from FORGED deviationDays on dummy).
 * % complete is intentionally unavailable — do not invent from calendar fraction.
 */
export function buildStatusSummary(
  data: ScheduleNavigatorPayload
): StatusSummary {
  const asOf = data.timeline.asOf ?? null;
  const asOfMs = asOf ? parseMs(asOf) : null;

  let daysBehind: number | null = null;
  let daysBehindNote =
    "Requires timeline.asOf to compute schedule slip from cascaded delays.";

  if (asOfMs != null) {
    const started = data.waypoints.filter(
      (w) => parseMs(w.plannedStart) <= asOfMs
    );
    if (started.length === 0) {
      daysBehind = 0;
      daysBehindNote = "No milestones started by as-of date.";
    } else {
      const latest = started.reduce((a, b) =>
        a.cascadeShiftAfter >= b.cascadeShiftAfter ? a : b
      );
      daysBehind = latest.cascadeShiftAfter;
      daysBehindNote =
        "Cumulative local delays on milestones that have started by as-of (cascade model). DERIVED from deviationDays.";
    }
  }

  // Next upcoming: first by plannedStart that has not finished on the planned calendar by asOf
  let nextMilestone: NavigatorWaypoint | null = null;
  if (asOfMs != null) {
    const upcoming = data.waypoints
      .filter((w) => parseMs(w.plannedEnd) > asOfMs)
      .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
    nextMilestone = upcoming[0] ?? null;
  } else {
    nextMilestone = data.waypoints[0] ?? null;
  }

  let worstUnresolvedDelay: NavigatorWaypoint | null = null;
  const delayCandidates =
    asOfMs != null
      ? data.waypoints.filter(
          (w) => w.localDelayDays > 0 && parseMs(w.plannedStart) <= asOfMs
        )
      : data.waypoints.filter((w) => w.localDelayDays > 0);

  if (delayCandidates.length > 0) {
    worstUnresolvedDelay = delayCandidates.reduce((a, b) =>
      b.localDelayDays > a.localDelayDays ||
      (b.localDelayDays === a.localDelayDays &&
        severityRank(b.severity) > severityRank(a.severity))
        ? b
        : a
    );
  }

  return {
    projectName: data.projectName,
    asOf,
    daysBehind,
    daysBehindProvenance: "DERIVED",
    daysBehindNote,
    percentComplete: null,
    percentCompleteNote:
      "Not available — payload has no project % complete (or earned-value) field; calendar elapsed would be fabricated.",
    nextMilestone,
    worstUnresolvedDelay,
  };
}

function severityRank(s: NavigatorWaypoint["severity"]): number {
  return s === "severe" ? 2 : s === "mild" ? 1 : 0;
}
