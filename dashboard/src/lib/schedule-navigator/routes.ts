import type {
  MilestoneAlert,
  NavigatorWaypoint,
  RecoveryOffer,
  ScheduleNavigatorPayload,
} from "./aggregate";
import {
  computeProjectedSchedule,
  daysBetweenIso,
  projectedFinish,
  projectedTaskEnds,
  type ProjectedWaypoint,
  type RouteEffects,
} from "./cpm";

/**
 * How deep recovery routes may nest: a route, a route off that, and one
 * more. Each level is drawn lifted above the path it branches from, and
 * every commit leaves a ghost below the live path — past three levels the
 * stack of offered tubes, the live path and its ghosts at one date stops
 * reading as a chain in 3D and becomes a bundle. Offers deeper than this are
 * dropped at aggregation (footnoted), never silently half-drawn.
 */
export const MAX_ROUTE_DEPTH = 3;

/**
 * Routes on offer for a payload. The real pipeline ships
 * `recoveryOffers`; the dummy scenario predates them and only carries a
 * per-waypoint `catchUpPlan`, which maps onto top-level claw-back offers.
 */
export function routeOffers(
  payload: Pick<ScheduleNavigatorPayload, "recoveryOffers" | "waypoints">
): RecoveryOffer[] {
  if (payload.recoveryOffers) return payload.recoveryOffers;
  return payload.waypoints.flatMap((w): RecoveryOffer[] => {
    const plan = w.catchUpPlan;
    if (!plan) return [];
    const days = Math.min(plan.daysRecovered, plan.daysLost, w.localDelayDays);
    if (days <= 0) return [];
    return [
      {
        id: `catchup-${w.id}`,
        parentId: null,
        depth: 1,
        waypointId: w.id,
        mode: "claw-back",
        taskId: w.id,
        taskName: w.taskNameEn || w.taskName,
        daysRecovered: days,
        daysLost: plan.daysLost,
        summary: plan.summary,
        resourceCost: plan.resourceCost,
        provenance: "FORGED",
      },
    ];
  });
}

/** On offer now: not taken, within the depth cap, and its parent (if any) taken. */
export function isOfferAvailable(offer: RecoveryOffer, taken: ReadonlySet<string>): boolean {
  return (
    !taken.has(offer.id) &&
    offer.depth <= MAX_ROUTE_DEPTH &&
    (offer.parentId === null || taken.has(offer.parentId))
  );
}

export function availableOffers(
  offers: RecoveryOffer[],
  takenIds: Iterable<string>
): RecoveryOffer[] {
  const taken = new Set(takenIds);
  return offers.filter((o) => isOfferAvailable(o, taken));
}

/** Engine input for a set of taken routes. */
export function routeEffects(
  offers: RecoveryOffer[],
  takenIds: Iterable<string>
): RouteEffects {
  const byId = new Map(offers.map((o) => [o.id, o]));
  const slip: Record<string, number> = {};
  const compress: Record<string, number> = {};
  for (const id of takenIds) {
    const o = byId.get(id);
    if (!o) continue;
    if (o.mode === "claw-back") slip[o.waypointId] = (slip[o.waypointId] ?? 0) + o.daysRecovered;
    else compress[o.taskId] = (compress[o.taskId] ?? 0) + o.daysRecovered;
  }
  return { slip, compress };
}

export function scheduleForRoutes(
  waypoints: NavigatorWaypoint[],
  offers: RecoveryOffer[],
  takenIds: Iterable<string>
): { projected: ProjectedWaypoint[]; projectedEnd: string; daysBehind: number } {
  const projected = computeProjectedSchedule(waypoints, routeEffects(offers, takenIds));
  return { projected, ...projectedFinish(waypoints, projected) };
}

export interface MilestoneProjection {
  /** DERIVED — latest projected end across the milestone's member tasks. */
  projectedEnd: string;
  /** DERIVED — days past the latest planned end of those same members. */
  slipDays: number;
  /** Every member task is measured: this is an as-built finish, not a forecast. */
  complete: boolean;
}

/**
 * Each milestone's projected completion under the routes taken. Compared
 * like with like — member tasks' projected ends against member tasks'
 * planned ends — because a summary bar's own dates can disagree with its
 * children's (substation Civil Works: summary 20 Dec, members 5 Dec).
 */
export function milestoneProjections(
  alerts: MilestoneAlert[] | undefined,
  waypoints: NavigatorWaypoint[],
  effects: Partial<RouteEffects>
): Record<string, MilestoneProjection> {
  const out: Record<string, MilestoneProjection> = {};
  if (!alerts?.length) return out;
  const tasks = projectedTaskEnds(waypoints, effects);
  for (const alert of alerts) {
    let planned = "";
    let projected = "";
    let complete = true;
    for (const id of alert.memberTaskIds ?? []) {
      const t = tasks.get(String(id));
      if (!t) continue;
      if (t.plannedEnd > planned) planned = t.plannedEnd;
      if (t.projectedEnd > projected) projected = t.projectedEnd;
      complete &&= t.measured;
    }
    if (!planned) continue;
    out[alert.milestoneId] = {
      projectedEnd: projected,
      slipDays: Math.max(0, daysBetweenIso(planned, projected)),
      complete,
    };
  }
  return out;
}

/** DERIVED — what taking `offer` on top of the routes already taken does. */
export interface RouteImpact {
  finishBefore: string;
  finishAfter: string;
  /** Negative = earlier. */
  finishDeltaDays: number;
  /** Waypoints whose projected end moves, in schedule order. */
  revised: { waypointId: string; name: string; before: string; after: string; deltaDays: number }[];
}

export function routeImpact(
  waypoints: NavigatorWaypoint[],
  offers: RecoveryOffer[],
  takenIds: string[],
  offer: RecoveryOffer
): RouteImpact {
  const withoutIds = takenIds.filter((id) => id !== offer.id);
  const before = scheduleForRoutes(waypoints, offers, withoutIds);
  const after = scheduleForRoutes(waypoints, offers, [...withoutIds, offer.id]);
  const revised = waypoints.flatMap((w, i) => {
    const b = before.projected[i].projectedEnd;
    const a = after.projected[i].projectedEnd;
    if (a === b) return [];
    return [
      {
        waypointId: w.id,
        name: w.taskNameEn || w.taskName,
        before: b,
        after: a,
        deltaDays: daysBetweenIso(b, a),
      },
    ];
  });
  return {
    finishBefore: before.projectedEnd,
    finishAfter: after.projectedEnd,
    finishDeltaDays: daysBetweenIso(before.projectedEnd, after.projectedEnd),
    revised,
  };
}
