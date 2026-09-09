import type {
  AsBuiltDeviation,
  DeviationDaysSource,
  FusionOutput,
  PlannedTask,
  PredictedMilestoneClass,
  ProjectMetadata,
  ProvenanceTag,
} from "@shared/schema/types";

export type DelaySeverity = "none" | "mild" | "severe";

/**
 * Aggregated milestone waypoint for the schedule navigator.
 */
export interface CatchUpPlan {
  /** Days originally lost at this waypoint (usually equals localDelayDays). */
  daysLost: number;
  /** Days recovered if this catch-up plan is applied (must be ≤ daysLost). */
  daysRecovered: number;
  /** Short human-readable description of the mitigation. */
  summary: string;
}

export interface NavigatorWaypoint {
  id: string;
  taskName: string;
  taskNameEn: string;
  milestoneClass: PredictedMilestoneClass;
  componentCount: number;
  plannedStart: string;
  plannedEnd: string;
  /** Max positive deviationDays in this task group (days). */
  localDelayDays: number;
  /** Cascaded projected end (ISO date) after cumulative shift + local delay. */
  projectedEnd: string;
  /** Cumulative shift applied *before* this waypoint's local delay (days). */
  cascadeShiftBefore: number;
  /** Cumulative shift after this waypoint (days). */
  cascadeShiftAfter: number;
  counts: {
    onTime: number;
    behind: number;
    ahead: number;
    /** Should stay 0 for scheduled task groups; kept for honesty. */
    notScheduled: number;
    delayedComponents: number;
  };
  /** Dominant (or only) source for deviationDays in this group. */
  deviationDaysSource: DeviationDaysSource | "unknown";
  severity: DelaySeverity;
  /** Free-text delay cause — present on dummy scenario; optional until schema lands. */
  delayReason?: string;
  /** Partial catch-up plan — present on some dummy delays; optional until schema lands. */
  catchUpPlan?: CatchUpPlan;
}

export interface ScheduleNavigatorPayload {
  projectId: string;
  projectName: string;
  timeline: {
    start: string;
    end: string;
    projectedEnd: string;
    /**
     * Calendar "today" for actual-vs-projected split.
     * Required on dummy scenario; optional until real pipeline exposes asOf.
     */
    asOf?: string;
  };
  waypoints: NavigatorWaypoint[];
  notScheduled: {
    count: number;
    note: string;
  };
  provenance: {
    deviationDays: ProvenanceTag;
    volumetricDeviationPct: ProvenanceTag;
    cascadeModel: string;
  };
  footnotes: string[];
  /** Dummy-only narrative pointer. */
  scenarioId?: string;
  scenarioSummary?: string;
  dataProvenance?: string;
}

function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

function severityForDelay(days: number): DelaySeverity {
  if (days <= 0) return "none";
  if (days <= 7) return "mild";
  return "severe";
}

interface TaskGroup {
  taskName: string;
  taskNameEn: string;
  milestoneClass: PredictedMilestoneClass;
  starts: string[];
  ends: string[];
  componentIds: Set<string>;
}

/**
 * Aggregate schedule + fusion + deviation into Maps-style route waypoints
 * with an illustrative cascading delay on the projected line.
 */
export function buildScheduleNavigatorPayload(
  schedule: PlannedTask[],
  fusion: FusionOutput[],
  deviations: AsBuiltDeviation[],
  metadata: ProjectMetadata
): ScheduleNavigatorPayload {
  const fusionBy = new Map(fusion.map((f) => [f.componentId, f]));
  const deviationBy = new Map(deviations.map((d) => [d.componentId, d]));

  const notScheduledCount = fusion.filter((f) => f.deviationFlag === "not_scheduled").length;

  const groups = new Map<string, TaskGroup>();
  for (const task of schedule) {
    const key = task.taskNameEn || task.taskName;
    let group = groups.get(key);
    if (!group) {
      const milestoneClass =
        metadata.milestoneVocabulary[task.taskName] ?? ("Other" as PredictedMilestoneClass);
      group = {
        taskName: task.taskName,
        taskNameEn: task.taskNameEn,
        milestoneClass,
        starts: [],
        ends: [],
        componentIds: new Set(),
      };
      groups.set(key, group);
    }
    group.starts.push(task.plannedStart);
    group.ends.push(task.plannedEnd);
    group.componentIds.add(task.componentId);
  }

  type Draft = Omit<
    NavigatorWaypoint,
    "projectedEnd" | "cascadeShiftBefore" | "cascadeShiftAfter" | "severity"
  > & { localDelayDays: number };

  const drafts: Draft[] = [...groups.entries()].map(([key, group]) => {
    group.starts.sort();
    group.ends.sort();

    let onTime = 0;
    let behind = 0;
    let ahead = 0;
    let notScheduled = 0;
    let delayedComponents = 0;
    let localDelayDays = 0;
    let forged = 0;
    let derived = 0;
    let unknownSource = 0;

    for (const id of group.componentIds) {
      const f = fusionBy.get(id);
      const d = deviationBy.get(id);

      if (f?.deviationFlag === "behind") behind += 1;
      else if (f?.deviationFlag === "ahead") ahead += 1;
      else if (f?.deviationFlag === "not_scheduled") notScheduled += 1;
      else if (f?.deviationFlag === "on_time") onTime += 1;

      if (d?.deviationDays != null && d.deviationDays > 0) {
        delayedComponents += 1;
        localDelayDays = Math.max(localDelayDays, d.deviationDays);
      }

      if (d?.deviationDaysSource === "forged") forged += 1;
      else if (d?.deviationDaysSource === "derived") derived += 1;
      else unknownSource += 1;
    }

    let deviationDaysSource: DeviationDaysSource | "unknown" = "unknown";
    if (forged >= derived && forged > 0) deviationDaysSource = "forged";
    else if (derived > forged) deviationDaysSource = "derived";
    else if (unknownSource > 0 && forged === 0 && derived === 0) deviationDaysSource = "unknown";

    return {
      id: key.replace(/\s+/g, "-").toLowerCase().slice(0, 64),
      taskName: group.taskName,
      taskNameEn: group.taskNameEn,
      milestoneClass: group.milestoneClass,
      componentCount: group.componentIds.size,
      plannedStart: group.starts[0],
      plannedEnd: group.ends[group.ends.length - 1],
      localDelayDays,
      counts: { onTime, behind, ahead, notScheduled, delayedComponents },
      deviationDaysSource,
    };
  });

  drafts.sort((a, b) => a.plannedEnd.localeCompare(b.plannedEnd));

  let cumulativeShift = 0;
  const waypoints: NavigatorWaypoint[] = drafts.map((draft) => {
    const cascadeShiftBefore = cumulativeShift;
    const projectedEnd = addDays(
      draft.plannedEnd,
      cascadeShiftBefore + draft.localDelayDays
    );
    cumulativeShift += draft.localDelayDays;
    return {
      ...draft,
      projectedEnd,
      cascadeShiftBefore,
      cascadeShiftAfter: cumulativeShift,
      // Color by local delay introduced at this waypoint (cascade still shifts X).
      // Using cascadeShiftBefore+local would paint nearly the entire route "severe"
      // after early delays accumulate — accurate to that formula, but misleading for
      // "where delay occurs." Local-only keeps segment color meaningful.
      severity: severityForDelay(draft.localDelayDays),
    };
  });

  const projectedEnds = waypoints.map((w) => w.projectedEnd).sort();
  const projectedEnd =
    projectedEnds[projectedEnds.length - 1] ?? metadata.overallTimeline.end;

  return {
    projectId: metadata.projectId,
    projectName: metadata.projectName,
    timeline: {
      start: metadata.overallTimeline.start,
      end: metadata.overallTimeline.end,
      projectedEnd,
    },
    waypoints,
    notScheduled: {
      count: notScheduledCount,
      note: "Unscheduled BIM components (deviationFlag: not_scheduled). Shown as their own category — never folded into behind-schedule or 0% complete.",
    },
    provenance: {
      deviationDays: "FORGED",
      volumetricDeviationPct: "FORGED",
      cascadeModel: "illustrative",
    },
    footnotes: [
      "Cascading delay is illustrative and not dependency-graph-aware — real task dependencies are not in the dataset. Each waypoint’s positive deviationDays shifts all subsequent projected milestones forward on the time axis.",
      "Projected line color reflects local delay introduced at each waypoint (FORGED deviationDays), not cumulative cascade. Cascade still stretches projected dates rightward.",
      "deviationDays values shown on this view are tagged FORGED (deviationDaysSource). volumetricDeviationPct is FORGED wherever displayed.",
      "1,203 components with deviationFlag not_scheduled are excluded from the projected route and listed separately.",
    ],
  };
}
