import type {
  AsBuiltDeviation,
  DeviationDaysSource,
  FusionOutput,
  Milestone,
  MilestoneRootCause,
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

/**
 * Milestone-level delay/risk alert — the "alert us at milestone delay"
 * trigger, distinct from per-task-group forecastRisk on waypoints. Rolled
 * up from a project's own Milestone records (memberTaskIds cross-referenced
 * against the current plannedSchedule + deviations), same any/min pattern
 * as TaskGroup. Empty array for projects without a milestone structure
 * (e.g. Schependomlaan).
 */
export interface MilestoneAlert {
  milestoneId: string;
  milestoneName: string;
  plannedStart: string;
  plannedEnd: string;
  /** DERIVED — true if ANY member task is on the critical path. */
  isCriticalPath: boolean;
  /** DERIVED — MIN totalSlackDays across member tasks; null if none carry slack data. */
  totalSlackDays: number | null;
  /** Same forecastRiskFor() logic as per-task waypoints, applied at milestone level. */
  forecastRisk?: ForecastRisk;
  /** DERIVED — only present when the milestone itself is at risk or already delayed. */
  rootCause?: MilestoneRootCause[];
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
   * Present on 1-2 dummy future waypoints; for real MSPDI-sourced projects,
   * derived from real isCriticalPath/totalSlackDays (zero-float critical
   * task -> "elevated", a few days of float left -> "watch") — see
   * forecastRiskFor. Optional wherever the source data has neither.
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
    /**
     * False when the project has zero as-built tracking (no fusion/deviation
     * records at all) — nothing has actually been measured yet, so the 3D
     * scene must not draw an "actual to date" line (there's nothing honest
     * to show as complete). True (or absent, for the dummy scenario) means
     * the normal actual-vs-projected split applies.
     */
    hasActualData?: boolean;
  };
  waypoints: NavigatorWaypoint[];
  /** Absent on the dummy scenario (predates this feature); always an array (possibly empty) on the real pipeline. */
  milestoneAlerts?: MilestoneAlert[];
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

/** Real calendar "today" (UTC date), clamped to not precede the project's own start. */
function todayClampedToStart(startIso: string): string {
  const today = formatDate(new Date());
  return today < startIso ? startIso : today;
}

/** A task counts as "a few days of float" below this threshold (watch, not yet elevated). */
const WATCH_SLACK_MAX_DAYS = 5;

/**
 * Real CPM-driven forecast risk: a critical-path task with zero float is an
 * "elevated" risk (any delay passes straight through to the finish date,
 * with no buffer to absorb it); a task with only a few days of slack left
 * is a "watch" (comfortable float doesn't get flagged at all). Only ever
 * applies when isCriticalPath/totalSlackDays are actually present in the
 * source (MSPDI-shaped real data); undefined for projects without them
 * (e.g. Schependomlaan), same as before this existed.
 */
function forecastRiskFor(
  isCriticalPath: boolean,
  totalSlackDays: number | null
): ForecastRisk | undefined {
  if (isCriticalPath && (totalSlackDays == null || totalSlackDays <= 0)) {
    return {
      predictedDelayDays: 0,
      riskLevel: "elevated",
      reason:
        "Zero-float critical-path task — any delay here passes straight through to the project finish date with no buffer to absorb it.",
    };
  }
  if (totalSlackDays != null && totalSlackDays > 0 && totalSlackDays <= WATCH_SLACK_MAX_DAYS) {
    const days = Math.round(totalSlackDays);
    return {
      predictedDelayDays: days,
      riskLevel: "watch",
      reason: `Only ${days}d of float remaining before this task turns critical.`,
    };
  }
  return undefined;
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
  /** True if any task in this group is on the source schedule's critical path. */
  isCriticalPath: boolean;
  /** Least float across the group's tasks (the binding constraint); null if source never computed it. */
  totalSlackDays: number | null;
}

/**
 * Aggregate schedule + fusion + deviation into Maps-style route waypoints
 * with an illustrative cascading delay on the projected line.
 */
/**
 * Roll up Milestone.memberTaskIds against the current schedule + deviations
 * into MilestoneAlert records: isCriticalPath (any)/totalSlackDays (min)
 * same as TaskGroup, plus a DERIVED root cause pointing at the specific
 * critical-path member task(s) driving the delay/risk — never a fabricated
 * narrative reason. Kept as its own pass (not folded into the TaskGroup
 * loop above) because milestones group by source-schedule hierarchy, not
 * by taskNameEn identity.
 */
function computeMilestoneAlerts(
  milestones: Milestone[],
  schedule: PlannedTask[],
  deviationBy: Map<string, AsBuiltDeviation>
): MilestoneAlert[] {
  // taskId on real ingested data can come through as a number (raw MSPDI UID
  // attributes parse numeric) even though the schema types it as string —
  // normalize both sides to string so the lookup doesn't silently miss.
  const taskById = new Map(schedule.map((t) => [String(t.taskId), t]));

  const ownDelayDays = (task: PlannedTask): number => {
    const d = deviationBy.get(String(task.componentId ?? task.taskId));
    return d?.deviationDays != null && d.deviationDays > 0 ? d.deviationDays : 0;
  };

  return milestones.map((milestone) => {
    const members = milestone.memberTaskIds
      .map((id) => taskById.get(String(id)))
      .filter((t): t is PlannedTask => Boolean(t));

    const isCriticalPath = members.some((t) => Boolean(t.isCriticalPath));
    let totalSlackDays: number | null = null;
    for (const t of members) {
      if (t.totalSlackDays != null) {
        totalSlackDays = totalSlackDays == null ? t.totalSlackDays : Math.min(totalSlackDays, t.totalSlackDays);
      }
    }

    // As-built case: a critical-path member already measured behind its
    // planned end — this IS the root cause, not a forecast.
    const alreadyBehind = members
      .filter((t) => t.isCriticalPath && ownDelayDays(t) > 0)
      .sort((a, b) => ownDelayDays(b) - ownDelayDays(a));

    let rootCause: MilestoneRootCause[] | undefined;
    if (alreadyBehind.length > 0) {
      rootCause = alreadyBehind.map((t) => ({
        taskId: t.taskId,
        taskName: t.taskNameEn || t.taskName,
        reason: `${ownDelayDays(t)} day(s) behind planned end (critical path).`,
      }));
    } else if (isCriticalPath && (totalSlackDays == null || totalSlackDays <= 0)) {
      // Forecast case: nothing has slipped yet, but these members have no
      // buffer to absorb a slip — they're the ones that WOULD cause it.
      const zeroFloatCritical = members.filter(
        (t) => t.isCriticalPath && (t.totalSlackDays == null || t.totalSlackDays <= 0)
      );
      rootCause = zeroFloatCritical.map((t) => ({
        taskId: t.taskId,
        taskName: t.taskNameEn || t.taskName,
        reason: "Critical-path task with zero float — no buffer to absorb any slip.",
      }));
    }

    const forecastRisk =
      alreadyBehind.length === 0 ? forecastRiskFor(isCriticalPath, totalSlackDays) : undefined;

    return {
      milestoneId: milestone.milestoneId,
      milestoneName: milestone.milestoneName,
      plannedStart: milestone.plannedStart,
      plannedEnd: milestone.plannedEnd,
      isCriticalPath,
      totalSlackDays,
      forecastRisk,
      rootCause,
    };
  });
}

export function buildScheduleNavigatorPayload(
  schedule: PlannedTask[],
  fusion: FusionOutput[],
  deviations: AsBuiltDeviation[],
  metadata: ProjectMetadata,
  milestones: Milestone[] = []
): ScheduleNavigatorPayload {
  // Keys normalized to string: real ingested PlannedTask.taskId values can
  // come through as JS numbers (e.g. MSPDI UID attributes parse numeric)
  // even though the schema types taskId/componentId as string — without
  // this, a numeric taskId used as the componentId fallback silently misses
  // every fusion/deviation lookup below (same class of bug already fixed in
  // computeMilestoneAlerts).
  const fusionBy = new Map(fusion.map((f) => [String(f.componentId), f]));
  const deviationBy = new Map(deviations.map((d) => [String(d.componentId), d]));

  const notScheduledCount = fusion.filter((f) => f.deviationFlag === "not_scheduled").length;

  // Zero as-built tracking (no fusion/deviation records at all — nothing's
  // actually started/been measured, e.g. a freshly-onboarded MSPDI schedule)
  // means the "latest waypoint with known status" heuristic below has
  // nothing to find and would otherwise silently fall back to the LAST
  // waypoint — i.e. "today" renders on top of "planned end" and the whole
  // path reads as complete. Use the real calendar date instead in that case,
  // and never synthesize an actual-to-date line for it.
  const hasAsBuiltData = fusion.length > 0 || deviations.length > 0;

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
        isCriticalPath: false,
        totalSlackDays: null,
      };
      groups.set(key, group);
    }
    group.starts.push(task.plannedStart);
    group.ends.push(task.plannedEnd);
    // componentId is absent for schedule-only projects with no BIM/spatial
    // layer — fall back to the task's own taskId so it still counts as one
    // unit of weight for the S-curve, instead of being silently dropped.
    // String(...) so this matches the string-keyed fusionBy/deviationBy maps
    // above even when the real taskId comes through as a JS number.
    group.componentIds.add(String(task.componentId ?? task.taskId));
    group.isCriticalPath = group.isCriticalPath || Boolean(task.isCriticalPath);
    if (task.totalSlackDays != null) {
      group.totalSlackDays =
        group.totalSlackDays == null
          ? task.totalSlackDays
          : Math.min(group.totalSlackDays, task.totalSlackDays);
    }
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

    // forecastRisk describes risk on a task that hasn't already slipped —
    // localDelayDays>0 means it already has a real, measured delay, which is
    // a different (already-happened) signal, not a forecast.
    const forecastRisk =
      localDelayDays === 0
        ? forecastRiskFor(group.isCriticalPath, group.totalSlackDays)
        : undefined;

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
      forecastRisk,
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
  // Only meaningful when there IS as-built data; with none, there's no
  // "frontier of measured data" to find, so use the real calendar date.
  let asOfIndex = -1;
  if (hasAsBuiltData) {
    drafts.forEach((d, i) => {
      if (d.counts.onTime + d.counts.behind + d.counts.ahead > 0) asOfIndex = i;
    });
    if (asOfIndex === -1) asOfIndex = drafts.length - 1;
  }
  const asOf = hasAsBuiltData
    ? (drafts[asOfIndex]?.plannedEnd ?? metadata.overallTimeline.end)
    : todayClampedToStart(metadata.overallTimeline.start);

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

    // No actual-to-date line at all when nothing's been measured yet — an
    // undefined cumulativeActualPct on every waypoint means the 3D scene has
    // no "complete" data to draw, per hasActualData below.
    let cumulativeActualPct: number | undefined;
    if (hasAsBuiltData) {
      if (i < asOfIndex) {
        cumulativeActualPct = cumulativePlannedPct;
      } else if (i === asOfIndex) {
        const completedShare =
          draft.componentCount > 0
            ? ((draft.counts.onTime + draft.counts.ahead) / draft.componentCount) * share
            : 0;
        cumulativeActualPct = Math.round((priorCumulativePlanned + completedShare) * 10) / 10;
      }
    }

    const severity = severityForDelay(draft.localDelayDays);
    const delayCategory =
      draft.localDelayDays > 0 ? DELAY_CATEGORY_BY_CLASS[draft.milestoneClass] : undefined;
    const delayReason =
      draft.localDelayDays > 0 && delayCategory
        ? delayReasonFor(draft.milestoneClass, delayCategory, severity)
        : undefined;
    const catchUpPlan =
      severity === "severe" && delayCategory
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

  const milestoneAlerts = computeMilestoneAlerts(milestones, schedule, deviationBy);

  return {
    projectId: metadata.projectId,
    projectName: metadata.projectName,
    timeline: {
      start: metadata.overallTimeline.start,
      end: metadata.overallTimeline.end,
      projectedEnd,
      asOf,
      hasActualData: hasAsBuiltData,
    },
    waypoints,
    milestoneAlerts,
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
      hasAsBuiltData
        ? `timeline.asOf (${asOf}) is FORGED: the latest waypoint plannedEnd with any known onTimeStatus (onTime+behind+ahead>0), not a real "today" field in the schema.`
        : `timeline.asOf (${asOf}) is the real calendar date (clamped to not precede the project's own start): this project has zero as-built tracking (no fusion/deviation records at all), so there is no "frontier of measured data" to derive today from.`,
      hasAsBuiltData
        ? "cumulativePlannedPct/cumulativeActualPct are FORGED: weighted by each waypoint's componentCount share of all scheduled components, same S-curve method as the dummy scenario. The asOf-frontier waypoint gets a partial actual value from its own onTime+ahead share; later waypoints have no actual value."
        : "cumulativeActualPct is intentionally absent on every waypoint (no actual-to-date line is drawn): this project has zero as-built tracking, so there is nothing measured yet to honestly show as complete. cumulativePlannedPct is still DERIVED from componentCount share.",
      "delayReason and delayCategory are FORGED template text/values, generated for every waypoint with localDelayDays>0, deterministically mapped from milestoneClass (not random) — mirroring the dummy scenario's tone, not measured mitigation data. catchUpPlan is generated only for waypoints with a severe (>7 day) delay, to keep the alternate-route overlay legible against real data's density of minor slips.",
      "milestone markers are FORGED: one per tracked milestoneClass (Structure/Framing/Envelope/Finishes), placed at that class's last waypoint by plannedEnd.",
      "forecastRisk is REAL/DERIVED wherever the source schedule provides isCriticalPath/totalSlackDays (MSPDI-sourced projects): a zero-float critical-path task is \"elevated\" risk, a task with 5 or fewer days of float is \"watch\", only ever set on waypoints with no already-realized delay (localDelayDays===0). Absent entirely for projects without real CPM float data (e.g. Schependomlaan).",
      milestoneAlerts.length > 0
        ? "milestoneAlerts is DERIVED from each project's own phase/summary schedule structure (e.g. MSPDI Engineering/Procurement/Civil Works/Installation/Commissioning), not the locked PredictedMilestoneClass vocabulary. rootCause never fabricates a human-language reason — it names the specific critical-path member task(s) already behind (as-built) or, pre-delay, the zero-float critical-path member(s) with no buffer to absorb a slip."
        : "milestoneAlerts is empty: this project's source schedule has no phase/summary structure to derive milestones from (e.g. Schependomlaan).",
    ],
  };
}
