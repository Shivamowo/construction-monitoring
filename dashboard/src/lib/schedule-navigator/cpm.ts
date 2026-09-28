import type { PredecessorLinkType } from "@shared/schema/types";

/**
 * One schedule task as the forward pass sees it. Carried on each
 * NavigatorWaypoint (`scheduleNodes`) so the client can re-level after a
 * recovery without the full plannedSchedule.
 *
 * plannedStart/plannedEnd/predecessors are REAL (straight from the source
 * schedule). measuredSlipDays is REAL where present: the as-built deviation
 * record's finish variance (actual finish − planned finish). Everything the
 * forward pass produces from these is DERIVED.
 */
export interface ScheduleNode {
  taskId: string;
  plannedStart: string;
  plannedEnd: string;
  /** Omitted when the task has no predecessor links. */
  predecessors?: { taskId: string; type: PredecessorLinkType; lagDays: number }[];
  /**
   * Measured finish variance in days. Present only when an as-built record
   * exists; such a task's finish is taken as measured, not re-computed.
   */
  measuredSlipDays?: number;
}

/** Waypoint-shaped input: anything carrying an id, planned dates, and its task nodes. */
export interface ProjectableWaypoint {
  id: string;
  plannedStart: string;
  plannedEnd: string;
  localDelayDays: number;
  scheduleNodes?: ScheduleNode[];
}

/**
 * What the recovery routes currently taken do to the schedule. Built from
 * the taken offers (see lib/schedule-navigator/routes.ts), never by hand.
 */
export interface RouteEffects {
  /**
   * waypointId → days of that waypoint's MEASURED slip clawed back — the
   * finish its successors see moves in by that much (never below zero slip).
   * The original catch-up semantics: the route works on downstream tasks,
   * but is keyed to the delay it buys back.
   */
  slip: Record<string, number>;
  /**
   * taskId → days cut from that not-yet-measured task's planned duration
   * (never below one day). How a route acts on work still ahead — the only
   * kind of recovery available once you are past the delay itself.
   */
  compress: Record<string, number>;
}

/** DERIVED — one waypoint's projected dates after the forward pass. */
export interface ProjectedWaypoint {
  /** Own measured delay still standing after any recovery on this waypoint (days). */
  residualLocal: number;
  /** Shift inherited from predecessors — how late logic lets this waypoint start (days). */
  cascadeBefore: number;
  /** Total shift of this waypoint's finish vs plan (days). */
  cascadeAfter: number;
  /** Earliest projected start across the waypoint's tasks. */
  projectedStart: string;
  projectedEnd: string;
}

/** DERIVED — one task's projected dates, for roll-ups that are not per waypoint. */
export interface ProjectedTask {
  plannedEnd: string;
  projectedEnd: string;
  /** True when the finish is an as-built measurement, not a forecast. */
  measured: boolean;
}

const DAY_MS = 86400000;

function toDay(iso: string): number {
  return Math.round(new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() / DAY_MS);
}

function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

interface PassResult {
  es: number;
  ef: number;
  logicShift: number;
}

/**
 * Forward-pass critical-path re-level.
 *
 * Each unmeasured task starts at the latest of its planned start and every
 * predecessor constraint (FS: pred finish + lag; SS: pred start + lag;
 * FF: pred finish + lag − own duration; SF: pred start + lag − own duration),
 * then runs for its planned duration (less any `effects.compress` on it).
 * Planned start is a floor: the engine never pulls work earlier than the
 * plan of record, so a zero-delay project projects exactly onto its plan and
 * a recovery can at best bring work back onto plan, not ahead of it.
 *
 * A task with an as-built record is measured, not computed: its finish is
 * planned finish + measured slip, less any `effects.slip` on its waypoint.
 */
function forwardPass(waypoints: ProjectableWaypoint[], effects: Partial<RouteEffects>) {
  type Node = ScheduleNode & { waypointIndex: number };
  const nodes = new Map<string, Node>();
  waypoints.forEach((w, waypointIndex) => {
    for (const n of w.scheduleNodes ?? []) {
      nodes.set(String(n.taskId), { ...n, waypointIndex });
    }
  });

  const slipRecoveredFor = (waypointIndex: number) => {
    const w = waypoints[waypointIndex];
    return Math.min(Math.max(0, effects.slip?.[w.id] ?? 0), Math.max(0, w.localDelayDays));
  };

  const early = new Map<string, PassResult>();
  const visiting = new Set<string>();

  const pass = (id: string): PassResult => {
    const hit = early.get(id);
    if (hit) return hit;
    const node = nodes.get(id)!;
    const ps = toDay(node.plannedStart);
    const pe = toDay(node.plannedEnd);
    const plannedDur = pe - ps;
    const dur =
      node.measuredSlipDays == null
        ? Math.max(Math.min(plannedDur, 1), plannedDur - Math.max(0, effects.compress?.[id] ?? 0))
        : plannedDur;

    // Cycle guard: a malformed link loop falls back to planned dates for
    // the task that closes it rather than recursing forever.
    visiting.add(id);
    let logicStart = Number.NEGATIVE_INFINITY;
    for (const link of node.predecessors ?? []) {
      const predId = String(link.taskId);
      if (!nodes.has(predId) || visiting.has(predId)) continue;
      const pred = pass(predId);
      const lag = link.lagDays ?? 0;
      const bound =
        link.type === "SS"
          ? pred.es + lag
          : link.type === "FF"
            ? pred.ef + lag - dur
            : link.type === "SF"
              ? pred.es + lag - dur
              : pred.ef + lag;
      logicStart = Math.max(logicStart, bound);
    }
    visiting.delete(id);

    const es = Math.max(ps, logicStart);
    const logicShift = Math.max(0, es - ps);

    let result: PassResult;
    if (node.measuredSlipDays != null) {
      const slip = node.measuredSlipDays;
      const effectiveSlip =
        slip > 0 ? Math.max(0, slip - slipRecoveredFor(node.waypointIndex)) : slip;
      const ef = pe + effectiveSlip;
      result = { es: ef - dur, ef, logicShift };
    } else {
      result = { es, ef: es + dur, logicShift };
    }
    early.set(id, result);
    return result;
  };

  return { nodes, pass, slipRecoveredFor };
}

/**
 * Per-waypoint projection. `effects` carries the recovery routes taken (see
 * RouteEffects). Waypoints without scheduleNodes (e.g. the dummy scenario)
 * fall back to their own planned end + residual local delay, with no
 * propagation: no dependency data means no cascade is claimed.
 */
export function computeProjectedSchedule(
  waypoints: ProjectableWaypoint[],
  effects: Partial<RouteEffects> = {}
): ProjectedWaypoint[] {
  const { pass, slipRecoveredFor } = forwardPass(waypoints, effects);

  return waypoints.map((w, waypointIndex) => {
    const recovered = slipRecoveredFor(waypointIndex);
    const residualLocal = Math.max(0, w.localDelayDays - recovered);
    const plannedStart = toDay(w.plannedStart);
    const plannedEnd = toDay(w.plannedEnd);
    const members = w.scheduleNodes ?? [];

    if (members.length === 0) {
      return {
        residualLocal,
        cascadeBefore: 0,
        cascadeAfter: residualLocal,
        projectedStart: fromDay(plannedStart),
        projectedEnd: fromDay(plannedEnd + residualLocal),
      };
    }

    let start = Number.POSITIVE_INFINITY;
    let finish = Number.NEGATIVE_INFINITY;
    let inherited = 0;
    for (const n of members) {
      const r = pass(String(n.taskId));
      start = Math.min(start, r.es);
      finish = Math.max(finish, r.ef);
      inherited = Math.max(inherited, r.logicShift);
    }
    const cascadeAfter = Math.max(0, finish - plannedEnd);
    return {
      residualLocal,
      cascadeBefore: Math.min(inherited, cascadeAfter),
      cascadeAfter,
      projectedStart: fromDay(start),
      projectedEnd: fromDay(Math.max(finish, plannedEnd)),
    };
  });
}

/**
 * Per-task projection, for roll-ups that don't follow waypoint grouping
 * (milestones group by source-schedule hierarchy). A measured task reports
 * its as-built finish — a route taken since can't un-happen it.
 */
export function projectedTaskEnds(
  waypoints: ProjectableWaypoint[],
  effects: Partial<RouteEffects> = {}
): Map<string, ProjectedTask> {
  const { nodes, pass } = forwardPass(waypoints, effects);
  const out = new Map<string, ProjectedTask>();
  for (const [id, node] of nodes) {
    const measured = node.measuredSlipDays != null;
    out.set(id, {
      plannedEnd: node.plannedEnd,
      projectedEnd: measured
        ? fromDay(toDay(node.plannedEnd) + node.measuredSlipDays!)
        : fromDay(pass(id).ef),
      measured,
    });
  }
  return out;
}

/**
 * DERIVED — overall projected finish: the latest projected waypoint end
 * (not the last waypoint's — under real dependencies the waypoint with the
 * latest planned end need not finish last), and days behind the latest
 * planned end.
 */
export function projectedFinish(
  waypoints: { plannedEnd: string }[],
  projected: ProjectedWaypoint[]
): { projectedEnd: string; daysBehind: number } {
  let end = Number.NEGATIVE_INFINITY;
  let planned = Number.NEGATIVE_INFINITY;
  projected.forEach((p, i) => {
    end = Math.max(end, toDay(p.projectedEnd));
    planned = Math.max(planned, toDay(waypoints[i].plannedEnd));
  });
  if (!Number.isFinite(end)) return { projectedEnd: "", daysBehind: 0 };
  return { projectedEnd: fromDay(end), daysBehind: Math.max(0, end - planned) };
}

/** Whole days from `fromIso` to `toIso` (negative if earlier). */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  return toDay(toIso) - toDay(fromIso);
}
