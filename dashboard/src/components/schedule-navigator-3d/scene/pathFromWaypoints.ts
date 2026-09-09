import * as THREE from "three";
import type {
  DelaySeverity,
  NavigatorWaypoint,
  ScheduleNavigatorPayload,
} from "@/lib/schedule-navigator/aggregate";
import {
  buildTimelineScale,
  dateToX,
  PCT_AXIS_X,
  pctToY,
  type TimelineScale,
} from "./timelineAxis";

/** A waypoint with local delay — drives shard placement. */
export interface DelayShardSpec {
  waypoint: NavigatorWaypoint;
  waypointIndex: number;
  curveT: number;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
}

/** A future waypoint with a predicted delay risk on the projected line. */
export interface ForecastShardSpec {
  waypoint: NavigatorWaypoint;
  waypointIndex: number;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
}

export interface ShardCluster {
  id: string;
  curveT: number;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  items: DelayShardSpec[];
  severity: DelaySeverity;
  representative: DelayShardSpec;
}

export interface NavigatorPathModel {
  waypoints: NavigatorWaypoint[];
  plannedCurve: THREE.CatmullRomCurve3;
  actualCurve: THREE.CatmullRomCurve3;
  projectedCurve: THREE.CatmullRomCurve3;
  plannedPoints: THREE.Vector3[];
  actualPoints: THREE.Vector3[];
  /** Live at-risk projected control points (today → finish). */
  projectedControlPoints: THREE.Vector3[];
  projectedControlPointsRest: THREE.Vector3[];
  shards: DelayShardSpec[];
  clusters: ShardCluster[];
  /** Predicted-risk markers on the projected (future) line. */
  forecastShards: ForecastShardSpec[];
  /** Last waypoint fully behind asOf (for HUD); today may sit between waypoints. */
  todayWaypointIndex: number;
  /** Calendar today from timeline.asOf. */
  todayIso: string;
  todayPosition: THREE.Vector3;
  todayTangent: THREE.Vector3;
  timelineScale: TimelineScale;
  timeline: ScheduleNavigatorPayload["timeline"];
  bounds: THREE.Box3;
}

export const X_SPAN = 42;
const LATERAL = 2.4;
export const SHARD_CLUSTER_RADIUS = 2.35;

const sevRank: Record<DelaySeverity, number> = {
  none: 0,
  mild: 1,
  severe: 2,
};

function parseTime(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isDelayWaypoint(waypoint: NavigatorWaypoint): boolean {
  return waypoint.localDelayDays > 0;
}

/** Future waypoint carrying a predicted (not-yet-happened) delay risk. */
export function isForecastWaypoint(
  waypoint: NavigatorWaypoint,
  asOfMs: number
): boolean {
  return Boolean(waypoint.forecastRisk) && parseTime(waypoint.plannedStart) > asOfMs;
}

/**
 * Build predicted-risk shard markers on the projected line — the future
 * counterpart to actual-path delay shards. Positions snap to the nearest
 * point on the projected curve (mirrors the actual-curve snap for past
 * shards) so markers sit exactly on the rendered tube.
 */
export function buildForecastShards(
  waypoints: NavigatorWaypoint[],
  fullJourneyPoints: THREE.Vector3[],
  projectedCurve: THREE.CatmullRomCurve3,
  asOfMs: number
): ForecastShardSpec[] {
  const shards: ForecastShardSpec[] = [];
  waypoints.forEach((waypoint, waypointIndex) => {
    if (!isForecastWaypoint(waypoint, asOfMs)) return;

    const ptIndex = waypointIndex + 1;
    const raw = fullJourneyPoints[ptIndex];
    if (!raw) return;

    let bestT = 0;
    let bestD = Infinity;
    for (let s = 0; s <= 48; s++) {
      const t = s / 48;
      const d = projectedCurve.getPoint(t).distanceToSquared(raw);
      if (d < bestD) {
        bestD = d;
        bestT = t;
      }
    }
    const position = projectedCurve.getPoint(bestT);
    const tangent = projectedCurve.getTangent(bestT).normalize();
    shards.push({ waypoint, waypointIndex, position, tangent });
  });
  return shards;
}

/**
 * Cumulative % of total project work planned complete by this waypoint
 * (weighted by componentCount share). Falls back to an even index-based
 * split when the source data has no weighted figure yet (pre-schema real
 * pipeline path).
 */
function plannedPct(
  waypoint: NavigatorWaypoint,
  index: number,
  total: number
): number {
  return waypoint.cumulativePlannedPct ?? ((index + 1) / total) * 100;
}

/**
 * Cumulative % of total project work actually complete at this waypoint —
 * the real value while work is in progress or done, the planned figure
 * once it lands (same total weight, just later), for forecasting forward.
 */
function progressPct(
  waypoint: NavigatorWaypoint,
  index: number,
  total: number
): number {
  return (
    waypoint.cumulativeActualPct ?? plannedPct(waypoint, index, total)
  );
}

/**
 * Recompute cascaded projected ends after applying optional recoveries.
 * `recoveries[id] = daysRecovered` reduces that waypoint's local delay.
 */
export function computeCascadedSchedule(
  waypoints: NavigatorWaypoint[],
  recoveries: Record<string, number> = {}
): {
  residualLocal: number;
  cascadeBefore: number;
  cascadeAfter: number;
  projectedEnd: string;
}[] {
  let cascade = 0;
  return waypoints.map((w) => {
    const recovered = Math.min(
      Math.max(0, recoveries[w.id] ?? 0),
      Math.max(0, w.localDelayDays)
    );
    const residualLocal = Math.max(0, w.localDelayDays - recovered);
    const cascadeBefore = cascade;
    const cascadeAfter = cascadeBefore + residualLocal;
    cascade = cascadeAfter;
    return {
      residualLocal,
      cascadeBefore,
      cascadeAfter,
      projectedEnd: addDays(w.plannedEnd, cascadeBefore + residualLocal),
    };
  });
}

export function clusterDelayShards(
  shards: DelayShardSpec[],
  radiusWorld: number = SHARD_CLUSTER_RADIUS
): ShardCluster[] {
  if (shards.length === 0) return [];
  const sorted = [...shards].sort((a, b) => a.curveT - b.curveT);
  const clusters: ShardCluster[] = [];

  for (const s of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && last.position.distanceTo(s.position) <= radiusWorld) {
      last.items.push(s);
      const n = last.items.length;
      last.curveT = last.items.reduce((sum, it) => sum + it.curveT, 0) / n;
      last.position = last.items
        .reduce((acc, it) => acc.add(it.position.clone()), new THREE.Vector3())
        .multiplyScalar(1 / n);
      last.tangent = last.items[Math.floor(n / 2)].tangent.clone().normalize();

      for (const it of last.items) {
        if (sevRank[it.waypoint.severity] > sevRank[last.severity]) {
          last.severity = it.waypoint.severity;
          last.representative = it;
        } else if (
          sevRank[it.waypoint.severity] === sevRank[last.severity] &&
          it.waypoint.localDelayDays > last.representative.waypoint.localDelayDays
        ) {
          last.representative = it;
        }
      }
      last.id = `c-${last.items.map((i) => i.waypoint.id).join("|").slice(0, 64)}`;
    } else {
      clusters.push({
        id: `c-${s.waypoint.id}`,
        curveT: s.curveT,
        position: s.position.clone(),
        tangent: s.tangent.clone(),
        items: [s],
        severity: s.waypoint.severity,
        representative: s,
      });
    }
  }

  return clusters;
}

function ensurePair(pts: THREE.Vector3[]): THREE.Vector3[] {
  if (pts.length >= 2) return pts;
  if (pts.length === 1) {
    return [pts[0].clone(), pts[0].clone().add(new THREE.Vector3(1, 0, 0))];
  }
  return [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)];
}

export function rebuildProjectedCurve(
  controlPoints: THREE.Vector3[]
): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    ensurePair(controlPoints.map((p) => p.clone())),
    false,
    "catmullrom",
    0.4
  );
}

export function buildJourneyPoints(
  waypoints: NavigatorWaypoint[],
  cascaded: ReturnType<typeof computeCascadedSchedule>,
  scale: TimelineScale
): THREE.Vector3[] {
  const total = waypoints.length;
  return waypoints.map((w, i) => {
    const lateral = Math.sin(i * 0.72) * LATERAL;
    const c = cascaded[i];
    const x = dateToX(c.projectedEnd, scale);
    const height = pctToY(progressPct(w, i, total));
    return new THREE.Vector3(x, height, lateral);
  });
}

/** Sample journey polyline at a calendar date (unified X scale). */
export function sampleJourneyAtDate(
  journeyPoints: THREE.Vector3[],
  scale: TimelineScale,
  iso: string
): { position: THREE.Vector3; tangent: THREE.Vector3; segmentIndex: number } {
  const targetX = dateToX(iso, scale);
  if (journeyPoints.length === 0) {
    return {
      position: new THREE.Vector3(targetX, 0.3, 0),
      tangent: new THREE.Vector3(1, 0, 0),
      segmentIndex: 0,
    };
  }
  if (journeyPoints.length === 1 || targetX <= journeyPoints[0].x) {
    const tangent =
      journeyPoints.length >= 2
        ? journeyPoints[1].clone().sub(journeyPoints[0]).normalize()
        : new THREE.Vector3(1, 0, 0);
    return {
      position: new THREE.Vector3(targetX, journeyPoints[0].y, journeyPoints[0].z),
      tangent,
      segmentIndex: 0,
    };
  }
  const last = journeyPoints[journeyPoints.length - 1];
  if (targetX >= last.x) {
    const prev = journeyPoints[journeyPoints.length - 2] ?? last;
    return {
      position: new THREE.Vector3(targetX, last.y, last.z),
      tangent: last.clone().sub(prev).normalize(),
      segmentIndex: Math.max(0, journeyPoints.length - 2),
    };
  }
  for (let i = 0; i < journeyPoints.length - 1; i++) {
    const a = journeyPoints[i];
    const b = journeyPoints[i + 1];
    if (targetX >= a.x && targetX <= b.x) {
      const span = Math.max(b.x - a.x, 1e-6);
      const t = (targetX - a.x) / span;
      const position = a.clone().lerp(b, t);
      position.x = targetX;
      const tangent = b.clone().sub(a).normalize();
      return { position, tangent, segmentIndex: i };
    }
  }
  return {
    position: last.clone(),
    tangent: new THREE.Vector3(1, 0, 0),
    segmentIndex: Math.max(0, journeyPoints.length - 2),
  };
}

/**
 * Build catch-up morph targets for the projected path after applying one or
 * more recoveries. Each recovery closes only daysRecovered/daysLost of that
 * waypoint's local delay; other delays keep their full residual. Multiple
 * entries in `recoveries` compound on the cascade (do not override each other).
 */
export function buildCatchUpProjectedControls(
  waypoints: NavigatorWaypoint[],
  timeline: ScheduleNavigatorPayload["timeline"],
  todayIso: string,
  todayPosition: THREE.Vector3,
  recoveries: Record<string, number>
): THREE.Vector3[] | null {
  const active = Object.entries(recoveries).filter(([, d]) => d > 0);
  if (active.length === 0) return null;

  const scale = buildTimelineScale({
    start: timeline.start,
    plannedEnd: timeline.end,
    projectedEnd: timeline.projectedEnd,
    todayIso,
    xSpan: X_SPAN,
  });

  const cascaded = computeCascadedSchedule(waypoints, recoveries);
  const journey = buildJourneyPoints(waypoints, cascaded, scale);
  const sample = sampleJourneyAtDate(journey, scale, todayIso);

  const controls: THREE.Vector3[] = [todayPosition.clone()];
  // Keep today's junction pinned; subsequent points use residual cascade
  for (let i = sample.segmentIndex + 1; i < journey.length; i++) {
    controls.push(journey[i].clone());
  }
  if (controls.length < 2) {
    controls.push(journey[journey.length - 1]?.clone() ?? todayPosition.clone());
  }
  controls[0] = todayPosition.clone();
  return controls;
}

/**
 * Build a visually distinct alternate-route preview: branches from the delay
 * shard's own position, bulges laterally so it reads alongside the current
 * projected path rather than overlapping it, and converges back to the
 * recovered target points by the end (Google-Maps-style reroute preview).
 */
export function buildRoutePreviewPoints(
  shardPosition: THREE.Vector3,
  targets: THREE.Vector3[]
): THREE.Vector3[] {
  const pts = [shardPosition.clone(), ...targets.map((p) => p.clone())];
  const n = pts.length;
  const maxOffset = 0.55;
  return pts.map((p, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const bulge = Math.sin(Math.PI * t) * maxOffset;
    return new THREE.Vector3(p.x, p.y, p.z + bulge);
  });
}

/** Days to apply from a waypoint's catch-up plan (0 if none / invalid). */
export function recoveryDaysForWaypoint(
  waypoint: NavigatorWaypoint | undefined
): number {
  if (!waypoint?.catchUpPlan) return 0;
  const { daysLost, daysRecovered } = waypoint.catchUpPlan;
  if (daysLost <= 0 || daysRecovered <= 0) return 0;
  // Cap at daysLost so ratio ≤ 1; never full-merge beyond the plan.
  return Math.min(daysRecovered, daysLost, waypoint.localDelayDays);
}

export interface PathModelInput {
  waypoints: NavigatorWaypoint[];
  timeline: ScheduleNavigatorPayload["timeline"];
}

/**
 * Build planned + actual-to-date + projected curves from calendar asOf.
 * PLACEHOLDER waypoint-fraction splits are gone — today is timeline.asOf.
 */
export function buildNavigatorPathModel(
  input: PathModelInput | NavigatorWaypoint[]
): NavigatorPathModel {
  const waypoints = Array.isArray(input) ? input : input.waypoints;
  const timeline = Array.isArray(input)
    ? {
        start: waypoints[0]?.plannedStart ?? "2015-03-02",
        end: waypoints[waypoints.length - 1]?.plannedEnd ?? "2015-09-18",
        projectedEnd:
          waypoints[waypoints.length - 1]?.projectedEnd ?? "2015-10-18",
        asOf: waypoints[0]?.plannedStart,
      }
    : input.timeline;

  const emptyCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
  ]);
  const emptyToday = new THREE.Vector3(0, pctToY(0), 0);

  if (!timeline.asOf) {
    throw new Error(
      "Schedule navigator 3D requires timeline.asOf (calendar today). Dummy scenario sets this; real aggregate must supply it."
    );
  }

  const todayIso = timeline.asOf;
  const emptyScale = buildTimelineScale({
    start: timeline.start,
    plannedEnd: timeline.end,
    projectedEnd: timeline.projectedEnd,
    todayIso,
    xSpan: X_SPAN,
  });

  if (waypoints.length === 0) {
    return {
      waypoints,
      plannedCurve: emptyCurve,
      actualCurve: emptyCurve.clone(),
      projectedCurve: emptyCurve.clone(),
      plannedPoints: [],
      actualPoints: [],
      projectedControlPoints: [],
      projectedControlPointsRest: [],
      shards: [],
      clusters: [],
      forecastShards: [],
      todayWaypointIndex: 0,
      todayIso,
      todayPosition: emptyToday,
      todayTangent: new THREE.Vector3(1, 0, 0),
      timelineScale: emptyScale,
      timeline,
      bounds: new THREE.Box3(),
    };
  }

  const timelineScale = buildTimelineScale({
    start: timeline.start,
    plannedEnd: timeline.end,
    projectedEnd: timeline.projectedEnd,
    todayIso,
    xSpan: X_SPAN,
  });

  const asOfMs = parseTime(todayIso);

  // Use stored cascade from payload (already scenario-consistent); recoveries
  // applied only when catch-up runs.
  const cascaded = waypoints.map((w) => ({
    residualLocal: w.localDelayDays,
    cascadeBefore: w.cascadeShiftBefore,
    cascadeAfter: w.cascadeShiftAfter,
    projectedEnd: w.projectedEnd,
  }));

  const plannedStartPt = new THREE.Vector3(
    dateToX(timeline.start, timelineScale),
    pctToY(0),
    0
  );
  const plannedPoints = [
    plannedStartPt,
    ...waypoints.map((w, i) => {
      const lateral = Math.sin(i * 0.72) * LATERAL;
      return new THREE.Vector3(
        dateToX(w.plannedEnd, timelineScale),
        pctToY(plannedPct(w, i, waypoints.length)),
        lateral * 0.28
      );
    }),
  ];

  // Journey control points begin with a synthetic anchor at timeline.start so
  // the glossy tube's first vertex lines up with the "START" label / axis rail
  // (both at x = dateToX(start) = 0), not with the first waypoint's end date.
  const fullJourneyPoints = [
    new THREE.Vector3(dateToX(timeline.start, timelineScale), pctToY(0), 0),
    ...buildJourneyPoints(waypoints, cascaded, timelineScale),
  ];
  const todaySample = sampleJourneyAtDate(
    fullJourneyPoints,
    timelineScale,
    todayIso
  );

  // Last waypoint whose projected end is on or before asOf
  let todayWaypointIndex = 0;
  for (let i = 0; i < waypoints.length; i++) {
    if (parseTime(waypoints[i].projectedEnd) <= asOfMs) {
      todayWaypointIndex = i;
    }
  }

  const actualPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= todaySample.segmentIndex; i++) {
    actualPoints.push(fullJourneyPoints[i].clone());
  }
  actualPoints.push(todaySample.position.clone());

  const projectedControlPoints: THREE.Vector3[] = [
    todaySample.position.clone(),
  ];
  for (let i = todaySample.segmentIndex + 1; i < fullJourneyPoints.length; i++) {
    projectedControlPoints.push(fullJourneyPoints[i].clone());
  }
  if (projectedControlPoints.length < 2) {
    projectedControlPoints.push(
      fullJourneyPoints[fullJourneyPoints.length - 1].clone()
    );
  }

  const projectedControlPointsRest = projectedControlPoints.map((p) =>
    p.clone()
  );

  const plannedCurve = new THREE.CatmullRomCurve3(
    ensurePair(plannedPoints),
    false,
    "catmullrom",
    0.4
  );
  const actualCurve = new THREE.CatmullRomCurve3(
    ensurePair(actualPoints),
    false,
    "catmullrom",
    0.4
  );
  const projectedCurve = rebuildProjectedCurve(projectedControlPoints);

  // Delay shards known by asOf (work started); in-progress delays sit at today
  const shards: DelayShardSpec[] = [];
  waypoints.forEach((waypoint, waypointIndex) => {
    if (!isDelayWaypoint(waypoint)) return;
    if (parseTime(waypoint.plannedStart) > asOfMs) return;

    let position: THREE.Vector3;
    let tangent: THREE.Vector3;
    let curveT: number;

    if (parseTime(waypoint.projectedEnd) <= asOfMs) {
      // fullJourneyPoints now leads with a synthetic start anchor, so the
      // waypoint-indexed point lives at index + 1.
      const ptIndex = waypointIndex + 1;
      position = fullJourneyPoints[ptIndex].clone();
      const prev =
        fullJourneyPoints[Math.max(0, ptIndex - 1)] ?? position;
      const next =
        fullJourneyPoints[Math.min(fullJourneyPoints.length - 1, ptIndex + 1)] ??
        position;
      tangent = next.clone().sub(prev).normalize();
      // Parameter along actual path by nearest sample
      let bestT = 0;
      let bestD = Infinity;
      for (let s = 0; s <= 48; s++) {
        const t = s / 48;
        const d = actualCurve.getPoint(t).distanceToSquared(position);
        if (d < bestD) {
          bestD = d;
          bestT = t;
        }
      }
      curveT = bestT;
      position = actualCurve.getPoint(curveT);
      tangent = actualCurve.getTangent(curveT).normalize();
    } else {
      position = todaySample.position.clone();
      tangent = todaySample.tangent.clone();
      curveT = 1;
    }

    shards.push({ waypoint, waypointIndex, curveT, position, tangent });
  });

  const clusters = clusterDelayShards(shards);
  const forecastShards = buildForecastShards(
    waypoints,
    fullJourneyPoints,
    projectedCurve,
    asOfMs
  );
  const bounds = new THREE.Box3().setFromPoints([
    ...plannedPoints,
    ...fullJourneyPoints,
    todaySample.position,
    new THREE.Vector3(0, timelineScale.axisY, timelineScale.axisZ),
    new THREE.Vector3(X_SPAN, timelineScale.axisY, timelineScale.axisZ),
    // % axis rail sits left of timeline start — include so the camera frames it in.
    new THREE.Vector3(PCT_AXIS_X, pctToY(0), timelineScale.axisZ),
    new THREE.Vector3(PCT_AXIS_X, pctToY(100), timelineScale.axisZ),
    ...forecastShards.map((f) => f.position),
  ]);

  return {
    waypoints,
    plannedCurve,
    actualCurve,
    projectedCurve,
    plannedPoints,
    actualPoints,
    projectedControlPoints,
    projectedControlPointsRest,
    shards,
    clusters,
    forecastShards,
    todayWaypointIndex,
    todayIso,
    todayPosition: todaySample.position.clone(),
    todayTangent: todaySample.tangent.clone(),
    timelineScale,
    timeline,
    bounds,
  };
}
