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

/** DERIVED — one waypoint's projected dates after the forward pass. */
export interface ProjectedWaypoint {
  /** Own measured delay still standing after any recovery on this waypoint (days). */
  residualLocal: number;
  /** Shift inherited from predecessors — how late logic lets this waypoint start (days). */
  cascadeBefore: number;
  /** Total shift of this waypoint's finish vs plan (days). */
  cascadeAfter: number;
  projectedEnd: string;
}

const DAY_MS = 86400000;

function toDay(iso: string): number {
  return Math.round(new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() / DAY_MS);
}

function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Forward-pass critical-path re-level.
 *
 * Each unmeasured task starts at the latest of its planned start and every
 * predecessor constraint (FS: pred finish + lag; SS: pred start + lag;
 * FF: pred finish + lag − own duration; SF: pred start + lag − own duration),
 * then runs for its planned duration. Planned start is a floor: the engine
 * never pulls work earlier than the plan of record, so a zero-delay project
 * projects exactly onto its plan.
 *
 * A task with an as-built record is measured, not computed: its finish is
 * planned finish + measured slip. `recoveries[waypointId] = days` pulls a
 * measured slip on that waypoint's tasks in by up to `days` (never below
 * zero slip) — the finish its successors see, which is what a catch-up route
 * buys back downstream.
 *
 * Waypoints without scheduleNodes (e.g. the dummy scenario) fall back to
 * their own planned end + residual local delay, with no propagation: no
 * dependency data means no cascade is claimed.
 */
export function computeProjectedSchedule(
  waypoints: ProjectableWaypoint[],
  recoveries: Record<string, number> = {}
): ProjectedWaypoint[] {
  type Node = ScheduleNode & { waypointIndex: number };
  const nodes = new Map<string, Node>();
  waypoints.forEach((w, waypointIndex) => {
    for (const n of w.scheduleNodes ?? []) {
      nodes.set(String(n.taskId), { ...n, waypointIndex });
    }
  });

  const recoveredFor = (waypointIndex: number) => {
    const w = waypoints[waypointIndex];
    return Math.min(Math.max(0, recoveries[w.id] ?? 0), Math.max(0, w.localDelayDays));
  };

  const early = new Map<string, { es: number; ef: number; logicShift: number }>();
  const visiting = new Set<string>();

  const pass = (id: string): { es: number; ef: number; logicShift: number } => {
    const hit = early.get(id);
    if (hit) return hit;
    const node = nodes.get(id)!;
    const ps = toDay(node.plannedStart);
    const pe = toDay(node.plannedEnd);
    const dur = pe - ps;

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

    let result: { es: number; ef: number; logicShift: number };
    if (node.measuredSlipDays != null) {
      const slip = node.measuredSlipDays;
      const effectiveSlip =
        slip > 0 ? Math.max(0, slip - recoveredFor(node.waypointIndex)) : slip;
      const ef = pe + effectiveSlip;
      result = { es: ef - dur, ef, logicShift };
    } else {
      result = { es, ef: es + dur, logicShift };
    }
    early.set(id, result);
    return result;
  };

  return waypoints.map((w, waypointIndex) => {
    const recovered = recoveredFor(waypointIndex);
    const residualLocal = Math.max(0, w.localDelayDays - recovered);
    const plannedEnd = toDay(w.plannedEnd);
    const members = w.scheduleNodes ?? [];

    if (members.length === 0) {
      return {
        residualLocal,
        cascadeBefore: 0,
        cascadeAfter: residualLocal,
        projectedEnd: fromDay(plannedEnd + residualLocal),
      };
    }

    let finish = Number.NEGATIVE_INFINITY;
    let inherited = 0;
    for (const n of members) {
      const r = pass(String(n.taskId));
      finish = Math.max(finish, r.ef);
      inherited = Math.max(inherited, r.logicShift);
    }
    const cascadeAfter = Math.max(0, finish - plannedEnd);
    return {
      residualLocal,
      cascadeBefore: Math.min(inherited, cascadeAfter),
      cascadeAfter,
      projectedEnd: fromDay(Math.max(finish, plannedEnd)),
    };
  });
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
