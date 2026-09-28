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
  RecoveryPlan,
} from "@shared/schema/types";
import {
  computeProjectedSchedule,
  projectedFinish,
  type ScheduleNode,
} from "./cpm";
import { MAX_ROUTE_DEPTH } from "./routes";

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
  /**
   * DERIVED — how many days this milestone is ALREADY measured behind: the
   * worst own-delay across its member tasks. 0 means nothing in it has
   * slipped yet (which is not the same as "safe" — see forecastRisk).
   * This is the headline figure for a milestone-level delay alert; rootCause
   * says which task(s) it came from.
   */
  delayDays: number;
  /** Same forecastRiskFor() logic as per-task waypoints, applied at milestone level. */
  forecastRisk?: ForecastRisk;
  /** DERIVED — only present when the milestone itself is at risk or already delayed. */
  rootCause?: MilestoneRootCause[];
  /**
   * REAL — the milestone's member task ids, from the source schedule's own
   * summary structure. Lets the client roll up projected dates per milestone
   * after routes are taken (see routes.ts milestoneProjections).
   */
  memberTaskIds: string[];
}

/**
 * One recovery route on offer. Routes nest: an offer with a parentId is only
 * on offer once that parent has been taken, so what is offered is keyed to
 * the chain of routes you're on, not just to a waypoint.
 */
export interface RecoveryOffer {
  id: string;
  /** Offer that must be taken first; null = on offer against the plan as issued. */
  parentId: string | null;
  /** 1 for a top-level offer, parent's depth + 1 below it. Capped at MAX_ROUTE_DEPTH. */
  depth: number;
  /** Waypoint the route acts on / branches from. */
  waypointId: string;
  /**
   * "claw-back": buys back `daysRecovered` of the waypoint's already-measured
   * slip (the route works downstream; the days come off the delay it
   * answers). "compress": cuts `daysRecovered` from the planned duration of
   * `taskId`, a task not yet measured.
   */
  mode: "claw-back" | "compress";
  taskId: string;
  taskName: string;
  /** Days the plan claims, clamped to what the mode can act on (slip, or duration − 1). */
  daysRecovered: number;
  /** claw-back only: the measured slip being answered. */
  daysLost?: number;
  summary: string;
  resourceCost: string;
  /**
   * REAL: taken verbatim from the project's own recovery-plan.json.
   * FORGED: template text generated for a severe delay on a project that
   * ships no recovery plan. What a route DOES to the finish is always
   * DERIVED by the CPM engine, never taken from the plan's claim.
   */
  provenance: "REAL" | "FORGED";
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
  /** DERIVED — projected end (ISO date) from the forward-pass re-level (cpm.ts). */
  projectedEnd: string;
  /** DERIVED — shift inherited from predecessors via dependency links (days). */
  cascadeShiftBefore: number;
  /** DERIVED — total shift of this waypoint's projected end vs plan (days). */
  cascadeShiftAfter: number;
  /**
   * Member tasks as forward-pass nodes: planned dates + predecessor links
   * REAL from the source schedule, measuredSlipDays REAL from as-built
   * records. Lets the client re-level after a recovery. Link-free tasks
   * sharing a slip value are collapsed to the latest-ending one (lossless
   * for the waypoint's projected end). Absent on the dummy scenario.
   */
  scheduleNodes?: ScheduleNode[];
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
  /**
   * LEGACY — dummy scenario only. The real pipeline emits routes as
   * payload.recoveryOffers instead (a nested route has no single waypoint
   * to hang off); routes.ts routeOffers() reads either.
   */
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
  /** Recovery routes on offer, nested via parentId. Absent on the dummy scenario (see catchUpPlan). */
  recoveryOffers?: RecoveryOffer[];
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

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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
  /** Member tasks as forward-pass nodes (see cpm.ts). */
  nodes: ScheduleNode[];
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

    // Worst own-delay across ALL members (not just critical ones): a
    // milestone is late if anything inside it is late, even where float
    // means it isn't driving the project finish.
    const delayDays = members.reduce((worst, t) => Math.max(worst, ownDelayDays(t)), 0);

    return {
      milestoneId: milestone.milestoneId,
      milestoneName: milestone.milestoneName,
      plannedStart: milestone.plannedStart,
      plannedEnd: milestone.plannedEnd,
      isCriticalPath,
      totalSlackDays,
      delayDays,
      forecastRisk,
      rootCause,
      memberTaskIds: milestone.memberTaskIds.map(String),
    };
  });
}

function waypointIdFor(groupKey: string): string {
  return groupKey.replace(/\s+/g, "-").toLowerCase().slice(0, 64);
}

/**
 * Recovery routes on offer. Entries from the project's own
 * recovery-plan.json are REAL (verbatim); `after` nests an entry under
 * another, so it is only offered once that one is taken. Clamped to what
 * each mode can act on; entries that can't act (claw-back against a task
 * with no measured slip, compress on finished work, orphaned or past
 * MAX_ROUTE_DEPTH) are dropped and reported rather than drawn inert.
 */
function buildRecoveryOffers(
  plan: RecoveryPlan | undefined,
  waypoints: NavigatorWaypoint[],
  schedule: PlannedTask[],
  taskIdToGroupKey: Map<string, string>,
  deviationBy: Map<string, AsBuiltDeviation>
): { offers: RecoveryOffer[]; dropped: string[] } {
  const waypointById = new Map(waypoints.map((w) => [w.id, w]));
  const taskById = new Map(schedule.map((t) => [String(t.taskId), t]));
  const dropped: string[] = [];
  const candidates: RecoveryOffer[] = [];

  for (const entry of plan?.catchUp ?? []) {
    const taskId = String(entry.taskId);
    const id = entry.id ?? `catchup-${taskId}`;
    const groupKey = taskIdToGroupKey.get(taskId);
    const waypoint = groupKey ? waypointById.get(waypointIdFor(groupKey)) : undefined;
    const task = taskById.get(taskId);
    if (!waypoint || !task) {
      dropped.push(`${id}: task ${taskId} not in schedule`);
      continue;
    }
    const mode = entry.mode ?? "claw-back";
    let daysRecovered: number;
    let daysLost: number | undefined;
    if (mode === "claw-back") {
      if (waypoint.localDelayDays <= 0) {
        dropped.push(`${id}: claw-back against ${waypoint.taskNameEn}, which has no measured slip`);
        continue;
      }
      daysLost = waypoint.localDelayDays;
      daysRecovered = Math.min(entry.daysRecovered, daysLost);
    } else {
      if (deviationBy.get(String(task.componentId ?? task.taskId))?.deviationDays != null) {
        dropped.push(`${id}: compress on ${waypoint.taskNameEn}, which is already measured`);
        continue;
      }
      const duration =
        (Date.parse(`${task.plannedEnd}T00:00:00Z`) - Date.parse(`${task.plannedStart}T00:00:00Z`)) /
        86400000;
      daysRecovered = Math.min(entry.daysRecovered, duration - 1);
    }
    if (daysRecovered <= 0) {
      dropped.push(`${id}: nothing to recover`);
      continue;
    }
    candidates.push({
      id,
      parentId: entry.after ?? null,
      depth: 1,
      waypointId: waypoint.id,
      mode,
      taskId,
      taskName: task.taskNameEn || task.taskName,
      daysRecovered,
      ...(daysLost != null ? { daysLost } : {}),
      summary: entry.summary,
      resourceCost: entry.resourceCost,
      provenance: "REAL",
    });
  }

  // Resolve nesting depth; an offer whose parent isn't on offer can never be
  // reached, and one past the cap isn't drawn — drop both, with a reason.
  const byId = new Map(candidates.map((o) => [o.id, o]));
  const depthOf = (o: RecoveryOffer, seen = new Set<string>()): number => {
    if (o.parentId === null) return 1;
    const parent = byId.get(o.parentId);
    if (!parent || seen.has(o.id)) return Number.POSITIVE_INFINITY;
    seen.add(o.id);
    return depthOf(parent, seen) + 1;
  };
  const offers: RecoveryOffer[] = [];
  for (const o of candidates) {
    const depth = depthOf(o);
    if (!Number.isFinite(depth)) dropped.push(`${o.id}: nests under ${o.parentId}, which is not on offer`);
    else if (depth > MAX_ROUTE_DEPTH) dropped.push(`${o.id}: depth ${depth} exceeds the ${MAX_ROUTE_DEPTH}-level cap`);
    else offers.push({ ...o, depth });
  }

  // FORGED fallback: a severe delay with no route of its own gets a
  // template route, as before (keeps the overlay legible on dense real data).
  for (const w of waypoints) {
    if (w.severity !== "severe" || !w.delayCategory) continue;
    if (offers.some((o) => o.waypointId === w.id && o.parentId === null)) continue;
    const forged = catchUpPlanFor(w.localDelayDays, w.delayCategory);
    if (forged.daysRecovered <= 0) continue;
    offers.push({
      id: `forged-${w.id}`,
      parentId: null,
      depth: 1,
      waypointId: w.id,
      mode: "claw-back",
      taskId: w.id,
      taskName: w.taskNameEn || w.taskName,
      daysRecovered: forged.daysRecovered,
      daysLost: forged.daysLost,
      summary: forged.summary,
      resourceCost: forged.resourceCost,
      provenance: "FORGED",
    });
  }
  return { offers, dropped };
}

/**
 * Link-free tasks affect only their own waypoint's projected end, which is
 * the max over members of plannedEnd + slip. For each distinct slip value
 * only the latest-ending task can be that max, so the rest are dropped —
 * lossless, and keeps a many-task, link-free schedule (Schependomlaan) from
 * shipping thousands of nodes.
 */
function collapseLinkFreeNodes(
  nodes: ScheduleNode[],
  linkedTaskIds: Set<string>
): ScheduleNode[] {
  const kept: ScheduleNode[] = [];
  const latestBySlip = new Map<string, ScheduleNode>();
  for (const n of nodes) {
    if (linkedTaskIds.has(n.taskId)) {
      kept.push(n);
      continue;
    }
    const slipKey = String(n.measuredSlipDays ?? "none");
    const best = latestBySlip.get(slipKey);
    if (!best || n.plannedEnd > best.plannedEnd) latestBySlip.set(slipKey, n);
  }
  return [...kept, ...latestBySlip.values()];
}

export function buildScheduleNavigatorPayload(
  schedule: PlannedTask[],
  fusion: FusionOutput[],
  deviations: AsBuiltDeviation[],
  metadata: ProjectMetadata,
  milestones: Milestone[] = [],
  availableRecovery?: RecoveryPlan
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
  // taskId -> the group key its waypoint ends up under, so a recovery plan
  // keyed by task can be matched to the waypoint carrying that task's delay.
  const taskIdToGroupKey = new Map<string, string>();
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
        nodes: [],
      };
      groups.set(key, group);
    }
    taskIdToGroupKey.set(String(task.taskId), key);
    group.starts.push(task.plannedStart);
    group.ends.push(task.plannedEnd);
    // componentId is absent for schedule-only projects with no BIM/spatial
    // layer — fall back to the task's own taskId so it still counts as one
    // unit of weight for the S-curve, instead of being silently dropped.
    // String(...) so this matches the string-keyed fusionBy/deviationBy maps
    // above even when the real taskId comes through as a JS number.
    group.componentIds.add(String(task.componentId ?? task.taskId));
    const measured = deviationBy.get(String(task.componentId ?? task.taskId))?.deviationDays;
    group.nodes.push({
      taskId: String(task.taskId),
      plannedStart: task.plannedStart,
      plannedEnd: task.plannedEnd,
      ...(task.predecessors?.length
        ? {
            predecessors: task.predecessors.map((l) => ({
              taskId: String(l.taskId),
              type: l.type,
              lagDays: l.lagDays ?? 0,
            })),
          }
        : {}),
      ...(measured != null ? { measuredSlipDays: measured } : {}),
    });
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

  // Tasks that some other task depends on — these must stay individual
  // nodes for the forward pass; everything link-free can be collapsed.
  const linkedTaskIds = new Set<string>();
  for (const task of schedule) {
    if (task.predecessors?.length) linkedTaskIds.add(String(task.taskId));
    for (const l of task.predecessors ?? []) linkedTaskIds.add(String(l.taskId));
  }

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
      id: waypointIdFor(key),
      taskName: group.taskName,
      taskNameEn: group.taskNameEn,
      milestoneClass: group.milestoneClass,
      componentCount: group.componentIds.size,
      plannedStart: group.starts[0],
      plannedEnd: group.ends[group.ends.length - 1],
      localDelayDays,
      scheduleNodes: collapseLinkFreeNodes(group.nodes, linkedTaskIds),
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
  // Preferred source: the schedule's own status date, when the source format
  // publishes one (MSPDI Project/StatusDate). That's a REAL "as of" field
  // stated by whoever issued the schedule, so it beats both heuristics below.
  const statusDate = metadata.statusDate;
  let asOfIndex = -1;
  if (statusDate) {
    // Frontier = last waypoint whose planned end has already passed as of the
    // stated status date. -1 (nothing passed yet) is valid and means the
    // status date sits before the first waypoint completes.
    drafts.forEach((d, i) => {
      if (d.plannedEnd <= statusDate) asOfIndex = i;
    });
  } else if (hasAsBuiltData) {
    drafts.forEach((d, i) => {
      if (d.counts.onTime + d.counts.behind + d.counts.ahead > 0) asOfIndex = i;
    });
    if (asOfIndex === -1) asOfIndex = drafts.length - 1;
  }
  const asOf = statusDate
    ? statusDate
    : hasAsBuiltData
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

  const projection = computeProjectedSchedule(drafts);

  let cumulativePlannedRunning = 0;
  const waypoints: NavigatorWaypoint[] = drafts.map((draft, i) => {
    const {
      projectedEnd,
      cascadeBefore: cascadeShiftBefore,
      cascadeAfter: cascadeShiftAfter,
    } = projection[i];

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
    const milestone = milestoneWaypointKeys.has(draft.id)
      ? { label: `${draft.milestoneClass} complete` }
      : undefined;

    return {
      ...draft,
      projectedEnd,
      cascadeShiftBefore,
      cascadeShiftAfter,
      // Color by local delay introduced at this waypoint (cascade still shifts X).
      // Using cascadeShiftBefore+local would paint nearly the entire route "severe"
      // after early delays accumulate — accurate to that formula, but misleading for
      // "where delay occurs." Local-only keeps segment color meaningful.
      severity,
      delayCategory,
      delayReason,
      milestone,
      cumulativePlannedPct,
      cumulativeActualPct,
    };
  });

  const projectedEnd =
    projectedFinish(drafts, projection).projectedEnd || metadata.overallTimeline.end;

  const milestoneAlerts = computeMilestoneAlerts(milestones, schedule, deviationBy);
  const { offers: recoveryOffers, dropped: droppedOffers } = buildRecoveryOffers(
    availableRecovery,
    waypoints,
    schedule,
    taskIdToGroupKey,
    deviationBy
  );

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
    recoveryOffers,
    notScheduled: {
      count: notScheduledCount,
      note: "Unscheduled BIM components (deviationFlag: not_scheduled). Shown as their own category — never folded into behind-schedule or 0% complete.",
    },
    provenance: {
      deviationDays: "FORGED",
      volumetricDeviationPct: "FORGED",
      cascadeModel: "cpm-forward-pass",
    },
    footnotes: [
      linkedTaskIds.size > 0
        ? "Projected dates are DERIVED by a forward-pass critical-path re-level over the source schedule's own predecessor links (FS/SS/FF/SF + lag). Tasks with an as-built record keep their measured finish; every other task starts at the later of its planned start and its predecessor constraints and runs its planned duration. Planned start is a floor — nothing is projected earlier than the plan of record."
        : "Projected dates are DERIVED, but this source schedule carries no predecessor links, so delay does NOT propagate: each waypoint's projected end is its own planned end plus its own measured slip. No cascade is claimed where the dependency data doesn't exist.",
      "Projected line color reflects local delay introduced at each waypoint (FORGED deviationDays), not cumulative cascade. Cascade still stretches projected dates rightward.",
      "deviationDays values shown on this view are tagged FORGED (deviationDaysSource). volumetricDeviationPct is FORGED wherever displayed.",
      "1,203 components with deviationFlag not_scheduled are excluded from the projected route and listed separately.",
      hasAsBuiltData
        ? statusDate
          ? `timeline.asOf (${asOf}) is REAL: the source schedule's own status date (e.g. MSPDI Project/StatusDate), as stated by whoever issued it.`
          : `timeline.asOf (${asOf}) is FORGED: the latest waypoint plannedEnd with any known onTimeStatus (onTime+behind+ahead>0), not a real "today" field in the schema.`
        : `timeline.asOf (${asOf}) is the real calendar date (clamped to not precede the project's own start): this project has zero as-built tracking (no fusion/deviation records at all), so there is no "frontier of measured data" to derive today from.`,
      hasAsBuiltData
        ? "cumulativePlannedPct/cumulativeActualPct are FORGED: weighted by each waypoint's componentCount share of all scheduled components, same S-curve method as the dummy scenario. The asOf-frontier waypoint gets a partial actual value from its own onTime+ahead share; later waypoints have no actual value."
        : "cumulativeActualPct is intentionally absent on every waypoint (no actual-to-date line is drawn): this project has zero as-built tracking, so there is nothing measured yet to honestly show as complete. cumulativePlannedPct is still DERIVED from componentCount share.",
      "delayReason and delayCategory are FORGED template text/values, generated for every waypoint with localDelayDays>0, deterministically mapped from milestoneClass (not random) — mirroring the dummy scenario's tone, not measured mitigation data. recoveryOffers are REAL where the project ships its own recovery-plan.json (each route on offer, taken from that file verbatim — including which route it nests under); a waypoint with a severe (>7 day) delay and no route of its own gets a FORGED template route, to keep the alternate-route overlay legible against real data's density of minor slips. What any route does to the projected finish is DERIVED by the CPM engine, never taken from the plan's own claim.",
      ...(droppedOffers.length
        ? [`recoveryOffers: ${droppedOffers.length} route(s) in recovery-plan.json were not offered — ${droppedOffers.join("; ")}.`]
        : []),
      "milestone markers are FORGED: one per tracked milestoneClass (Structure/Framing/Envelope/Finishes), placed at that class's last waypoint by plannedEnd.",
      "forecastRisk is REAL/DERIVED wherever the source schedule provides isCriticalPath/totalSlackDays (MSPDI-sourced projects): a zero-float critical-path task is \"elevated\" risk, a task with 5 or fewer days of float is \"watch\", only ever set on waypoints with no already-realized delay (localDelayDays===0). Absent entirely for projects without real CPM float data (e.g. Schependomlaan).",
      milestoneAlerts.length > 0
        ? "milestoneAlerts is DERIVED from each project's own phase/summary schedule structure (e.g. MSPDI Engineering/Procurement/Civil Works/Installation/Commissioning), not the locked PredictedMilestoneClass vocabulary. rootCause never fabricates a human-language reason — it names the specific critical-path member task(s) already behind (as-built) or, pre-delay, the zero-float critical-path member(s) with no buffer to absorb a slip."
        : "milestoneAlerts is empty: this project's source schedule has no phase/summary structure to derive milestones from (e.g. Schependomlaan).",
    ],
  };
}
