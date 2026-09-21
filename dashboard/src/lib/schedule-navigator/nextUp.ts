import type { MilestoneAlert, NavigatorWaypoint, ScheduleNavigatorPayload } from "./aggregate";

/**
 * "What's coming up" for the navigator, in the shape a satnav gives it:
 * the next thing you need to know about, plus a glance at the one after.
 *
 * Driven off the scrub position rather than today, so dragging the playhead
 * reads like moving along the route — the banner answers "what do I hit
 * next from here", which is the question the 3D path itself can't answer
 * without the user reading dates off the axis.
 */
export type ManeuverKind = "milestone" | "critical" | "risk" | "delay" | "finish";

export interface Maneuver {
  kind: ManeuverKind;
  /** The thing itself — a milestone or task name. */
  label: string;
  /** Why it matters, in a few words. */
  detail: string;
  dateIso: string;
  /** Whole days from the scrub position. Never negative. */
  daysAway: number;
}

function parseMs(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseMs(toIso) - parseMs(fromIso)) / 86_400_000);
}

function milestoneManeuver(alert: MilestoneAlert): Maneuver {
  return {
    kind: "milestone",
    label: alert.milestoneName,
    detail:
      alert.delayDays > 0
        ? `Milestone completes · ${alert.delayDays}d behind`
        : "Milestone completes",
    dateIso: alert.plannedEnd,
    daysAway: 0,
  };
}

function waypointManeuver(waypoint: NavigatorWaypoint): Maneuver | null {
  const name = waypoint.taskNameEn || waypoint.taskName;

  // Already-measured delay ahead of the scrub point: the strongest signal,
  // so it outranks a forecast on the same task.
  if (waypoint.localDelayDays > 0) {
    return {
      kind: "delay",
      label: name,
      detail: `Running ${waypoint.localDelayDays}d late`,
      dateIso: waypoint.projectedEnd,
      daysAway: 0,
    };
  }

  const risk = waypoint.forecastRisk;
  if (!risk) return null;

  // "elevated" is forecastRiskFor's zero-float critical-path case; "watch"
  // is a task with float left but not much. Different things to say.
  if (risk.riskLevel === "elevated") {
    return {
      kind: "critical",
      label: name,
      detail: "Critical path · no float",
      dateIso: waypoint.projectedEnd,
      daysAway: 0,
    };
  }
  return {
    kind: "risk",
    label: name,
    detail: `${risk.predictedDelayDays}d float left`,
    dateIso: waypoint.projectedEnd,
    daysAway: 0,
  };
}

/**
 * The next two things ahead of `fromIso`. Returns [] once past everything —
 * the caller hides the banner rather than showing an empty one.
 */
export function buildNextUp(
  payload: ScheduleNavigatorPayload,
  fromIso: string
): Maneuver[] {
  const fromMs = parseMs(fromIso);

  const candidates: Maneuver[] = [
    ...(payload.milestoneAlerts ?? []).map(milestoneManeuver),
    ...payload.waypoints
      .map(waypointManeuver)
      .filter((m): m is Maneuver => m !== null),
  ];

  const finishIso = payload.timeline.projectedEnd;
  if (finishIso) {
    candidates.push({
      kind: "finish",
      label: "Project finish",
      detail: "Projected completion",
      dateIso: finishIso,
      daysAway: 0,
    });
  }

  const ahead = candidates
    .filter((m) => parseMs(m.dateIso) > fromMs)
    .sort((a, b) => parseMs(a.dateIso) - parseMs(b.dateIso));

  // One entry per date: several tasks can land on the same day, and a satnav
  // does not read all of them out. Milestones win, then critical, then the
  // rest — ranked by how much the user needs to act on it.
  const RANK: Record<ManeuverKind, number> = {
    milestone: 0,
    delay: 1,
    critical: 2,
    risk: 3,
    finish: 4,
  };
  const byDate = new Map<string, Maneuver>();
  for (const m of ahead) {
    const held = byDate.get(m.dateIso);
    if (!held || RANK[m.kind] < RANK[held.kind]) byDate.set(m.dateIso, m);
  }

  return [...byDate.values()]
    .sort((a, b) => parseMs(a.dateIso) - parseMs(b.dateIso))
    .slice(0, 2)
    .map((m) => ({ ...m, daysAway: Math.max(0, daysBetween(fromIso, m.dateIso)) }));
}
