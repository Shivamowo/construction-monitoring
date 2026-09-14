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
export type DelayCategory = "customs" | "weather" | "labor" | "other";

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
  /** What taking this route actually costs (crew/schedule tradeoff). */
  resourceCost: string;
}

/** Predicted delay risk on a future (not-yet-started/not-yet-due) waypoint. */
export interface ForecastRisk {
  /** Days that would be lost if this risk materializes. */
  predictedDelayDays: number;
  riskLevel: "watch" | "elevated";
  /** Free-text forecast rationale — why this risk is flagged now. */
  reason: string;
}

export interface StructuralMilestone {
  label: string;
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
  /** Informational UI category for delay/forecast filtering. */
  delayCategory?: DelayCategory;
  /** Free-text delay cause — present on dummy scenario; optional until schema lands. */
  delayReason?: string;
  /** Partial catch-up plan — present on some dummy delays; optional until schema lands. */
  catchUpPlan?: CatchUpPlan;
  /**
   * Cumulative % of total project work (weighted by componentCount) planned
   * complete by this waypoint's plannedEnd. Drives the planned reference
   * line's Y axis. Present on dummy scenario; real pipeline should derive it
   * from cumulative componentCount share once schema lands.
   */
  cumulativePlannedPct?: number;
  /**
   * Cumulative % of total project work actually complete as of timeline.asOf,
   * for waypoints finished or in progress by then (undefined once work has
   * not started). Drives the actual-to-date line's Y axis. Present on dummy
   * scenario; real pipeline should derive it from fusion.json completionPct
   * once schema lands.
   */
  cumulativeActualPct?: number;
  /**
   * Predicted delay risk on the projected (forecast) line — distinct from
   * localDelayDays, which only describes delay that has already happened.
   * Present on 1-2 dummy future waypoints; optional until real pipeline
   * exposes a risk model.
   */
  forecastRisk?: ForecastRisk;
  /** Structural checkpoint marker; state is derived from timeline.asOf. */
  milestone?: StructuralMilestone;
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

/** Deterministic milestoneClass -> delayCategory mapping (reuses dummy's category intent). */
const DELAY_CATEGORY_BY_CLASS: Record<PredictedMilestoneClass, DelayCategory> = {
  Structure: "weather",
  Framing: "customs",
  Envelope: "labor",
  MEP: "labor",
  Finishes: "customs",
  Other: "other",
};

/** Recovery fraction + resource narrative by category, mirroring dummy's catch-up tone. */
const CATCH_UP_BY_CATEGORY: Record<
  DelayCategory,
  { recoveryFraction: number; resourceCost: string }
> = {
  weather: {
    recoveryFraction: 0.65,
    resourceCost: "+extra crews and weekend overtime to compress the schedule",
  },
  labor: {
    recoveryFraction: 0.6,
    resourceCost: "+temporary labor hires and overlapping shifts",
  },
  customs: {
    recoveryFraction: 0,
    resourceCost: "no resource lever available; hold is external to project control",
  },
  other: {
    recoveryFraction: 0.5,
    resourceCost: "+schedule replanning and crew reallocation",
  },
};

function delayReasonFor(milestoneClass: PredictedMilestoneClass, category: DelayCategory, severity: DelaySeverity): string {
  const adjective = severity === "severe" ? "Extended" : "Brief";
  const byCategory: Record<DelayCategory, string> = {
    weather: `${adjective} adverse weather interrupted ${milestoneClass.toLowerCase()} work during this phase.`,
    customs: `${adjective} customs/import hold-ups delayed material delivery for this ${milestoneClass.toLowerCase()} phase.`,
    labor: `${adjective} labor/crew availability constraints slowed ${milestoneClass.toLowerCase()} progress.`,
    other: `${adjective} coordination and scope-change delays affected this ${milestoneClass.toLowerCase()} phase.`,
  };
  return byCategory[category];
}

function catchUpPlanFor(localDelayDays: number, category: DelayCategory): CatchUpPlan {
  const { recoveryFraction, resourceCost } = CATCH_UP_BY_CATEGORY[category];
  const daysRecovered = Math.round(localDelayDays * recoveryFraction);
  const summary =
    daysRecovered > 0
      ? `Recovers ${daysRecovered} of ${localDelayDays} lost days; ${localDelayDays - daysRecovered} remain on the cascade.`
      : `No recovery available; all ${localDelayDays} days remain on the cascade.`;
  return { daysLost: localDelayDays, daysRecovered, summary, resourceCost };
}

/**
 * milestoneClass buckets treated as structural checkpoints, each contributing one
 * "<class> complete" marker at its last (by plannedEnd) waypoint — analogous to the
 * dummy scenario's 4-of-9 checkpoint density.
 */
const MILESTONE_CLASSES: PredictedMilestoneClass[] = [
  "Structure",
  "Framing",
  "Envelope",
  "Finishes",
];

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

  // Weight normalizer = sum of every group's componentCount (not a union of ids):
  // the same physical component recurs across multiple taskNameEn groups (e.g.
  // formwork -> rebar -> pour), so a de-duplicated id union would undercount and
  // let cumulative % run past 100. Summing group counts guarantees the S-curve
  // lands at exactly 100% by construction, matching the dummy scenario's intent
  // (share of total scheduled work) without assuming 1 component : 1 task.
  const totalComponents =
    drafts.reduce((sum, d) => sum + d.componentCount, 0) || 1;

  // "today" for this historical dataset: latest plannedEnd among waypoints with any
  // known on-time status (onTime+behind+ahead > 0) — the frontier of measured data.
  let asOfIndex = -1;
  drafts.forEach((d, i) => {
    if (d.counts.onTime + d.counts.behind + d.counts.ahead > 0) asOfIndex = i;
  });
  if (asOfIndex === -1) asOfIndex = drafts.length - 1;
  const asOf = drafts[asOfIndex]?.plannedEnd ?? metadata.overallTimeline.end;

  // Pick one "<class> complete" milestone per tracked class: its last (by plannedEnd) waypoint.
  const milestoneWaypointKeys = new Set<string>();
  for (const cls of MILESTONE_CLASSES) {
    let lastKey: string | null = null;
    for (const draft of drafts) {
      if (draft.milestoneClass === cls) lastKey = draft.id;
    }
    if (lastKey) milestoneWaypointKeys.add(lastKey);
  }

  let cumulativeShift = 0;
  let cumulativePlannedRunning = 0;
  const waypoints: NavigatorWaypoint[] = drafts.map((draft, i) => {
    const cascadeShiftBefore = cumulativeShift;
    const projectedEnd = addDays(
      draft.plannedEnd,
      cascadeShiftBefore + draft.localDelayDays
    );
    cumulativeShift += draft.localDelayDays;

    const priorCumulativePlanned = cumulativePlannedRunning;
    const share = (draft.componentCount / totalComponents) * 100;
    cumulativePlannedRunning += share;
    const cumulativePlannedPct = Math.round(cumulativePlannedRunning * 10) / 10;

    let cumulativeActualPct: number | undefined;
    if (i < asOfIndex) {
      cumulativeActualPct = cumulativePlannedPct;
    } else if (i === asOfIndex) {
      const completedShare =
        draft.componentCount > 0
          ? ((draft.counts.onTime + draft.counts.ahead) / draft.componentCount) * share
          : 0;
      cumulativeActualPct = Math.round((priorCumulativePlanned + completedShare) * 10) / 10;
    }

    const severity = severityForDelay(draft.localDelayDays);
    const delayCategory =
      draft.localDelayDays > 0 ? DELAY_CATEGORY_BY_CLASS[draft.milestoneClass] : undefined;
    const delayReason =
      draft.localDelayDays > 0 && delayCategory
        ? delayReasonFor(draft.milestoneClass, delayCategory, severity)
        : undefined;
    const catchUpPlan =
      draft.localDelayDays > 0 && delayCategory
        ? catchUpPlanFor(draft.localDelayDays, delayCategory)
        : undefined;
    const milestone = milestoneWaypointKeys.has(draft.id)
      ? { label: `${draft.milestoneClass} complete` }
      : undefined;

    return {
      ...draft,
      projectedEnd,
      cascadeShiftBefore,
      cascadeShiftAfter: cumulativeShift,
      // Color by local delay introduced at this waypoint (cascade still shifts X).
      // Using cascadeShiftBefore+local would paint nearly the entire route "severe"
      // after early delays accumulate — accurate to that formula, but misleading for
      // "where delay occurs." Local-only keeps segment color meaningful.
      severity,
      delayCategory,
      delayReason,
      catchUpPlan,
      milestone,
      cumulativePlannedPct,
      cumulativeActualPct,
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
      asOf,
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
      `timeline.asOf (${asOf}) is FORGED: the latest waypoint plannedEnd with any known onTimeStatus (onTime+behind+ahead>0), not a real "today" field in the schema.`,
      "cumulativePlannedPct/cumulativeActualPct are FORGED: weighted by each waypoint's componentCount share of all scheduled components, same S-curve method as the dummy scenario. The asOf-frontier waypoint gets a partial actual value from its own onTime+ahead share; later waypoints have no actual value.",
      "delayReason, catchUpPlan, and delayCategory are FORGED template text/values, generated only for waypoints with localDelayDays>0, deterministically mapped from milestoneClass (not random) — mirroring the dummy scenario's tone, not measured mitigation data.",
      "milestone markers are FORGED: one per tracked milestoneClass (Structure/Framing/Envelope/Finishes), placed at that class's last waypoint by plannedEnd.",
    ],
  };
}
