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

export interface CriticalWaypointSpec {
  waypoint: NavigatorWaypoint;
  waypointIndex: number;
  endImpactDays: number;
  floatDays: number;
  isCritical: boolean;
  position: THREE.Vector3;
}

export interface ProjectedSegmentSpec {
  waypointIndex: number;
  startX: number;
  endX: number;
  isCritical: boolean;
}

export interface MilestoneSpec {
  waypoint: NavigatorWaypoint;
  waypointIndex: number;
  state: "reached" | "upcoming";
  position: THREE.Vector3;
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
  criticalPath: CriticalWaypointSpec[];
  projectedSegments: ProjectedSegmentSpec[];
  milestones: MilestoneSpec[];
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

    const hit = curvePointAtX(projectedCurve, raw.x);
    shards.push({ waypoint, waypointIndex, position: hit.position, tangent: hit.tangent });
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
  return Math.min(100, waypoint.cumulativePlannedPct ?? ((index + 1) / total) * 100);
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
  return Math.min(
    100,
    waypoint.cumulativeActualPct ?? plannedPct(waypoint, index, total)
  );
}

/**
 * A project cannot be more than 100% complete, so no line may continue past
 * the first control point that reaches it — anything drawn beyond would be a
 * flat run at 100% implying work happening after completion. Keeps the point
 * that lands on 100% (that IS the terminus) and drops everything after it.
 */
export function truncateAtFullCompletion(
  points: THREE.Vector3[]
): THREE.Vector3[] {
  const yFull = pctToY(100);
  const idx = points.findIndex((p) => p.y >= yFull - 1e-6);
  if (idx < 0) return points;
  const keep = Math.max(idx + 1, 2);
  return keep >= points.length ? points : points.slice(0, keep);
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

/**
 * Identify schedule drivers by measuring each waypoint's remaining contribution
 * to the current projected finish. A zero-impact waypoint has float; a positive
 * impact is on the current critical path. This remains valid after recoveries.
 */
export function computeCriticalPath(
  waypoints: NavigatorWaypoint[],
  recoveries: Record<string, number> = {}
): Array<Pick<CriticalWaypointSpec, "waypoint" | "waypointIndex" | "endImpactDays" | "floatDays" | "isCritical">> {
  const current = computeCascadedSchedule(waypoints, recoveries);
  const currentEnd = current[current.length - 1]?.projectedEnd;
  if (!currentEnd) return [];

  return current.map((entry, waypointIndex) => {
    const waypoint = waypoints[waypointIndex];
    const actualResidual = Math.max(
      0,
      waypoint.localDelayDays - Math.min(
        Math.max(0, recoveries[waypoint.id] ?? 0),
        waypoint.localDelayDays
      )
    );
    const forecastResidual = waypoint.forecastRisk
      ? Math.max(
          0,
          waypoint.forecastRisk.predictedDelayDays - Math.min(
            Math.max(0, recoveries[waypoint.id] ?? 0),
            waypoint.forecastRisk.predictedDelayDays
          )
        )
      : 0;
    const unresolvedActual = actualResidual > 0 && !waypoint.catchUpPlan;
    const isCritical = unresolvedActual || forecastResidual > 0;
    const withoutResidual = computeCascadedSchedule(waypoints, {
      ...recoveries,
      [waypoint.id]: waypoint.localDelayDays,
    });
    const alternateEnd = withoutResidual[withoutResidual.length - 1]?.projectedEnd ?? currentEnd;
    const cascadeImpactDays = Math.max(
      0,
      Math.round((parseTime(currentEnd) - parseTime(alternateEnd)) / 86400000)
    );
    const endImpactDays = isCritical
      ? Math.max(cascadeImpactDays, actualResidual + forecastResidual)
      : 0;
    return {
      waypoint,
      waypointIndex,
      endImpactDays,
      floatDays: isCritical ? 0 : actualResidual + forecastResidual,
      isCritical,
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

/**
 * Minimum X spacing between consecutive projected/alt-route control points.
 * Real schedule data can put several waypoints' projected-end dates within
 * days of each other, producing control points only a fraction of a unit
 * apart in X. CatmullRom, even with strictly-increasing control-point X,
 * overshoots between such closely-spaced points and briefly retraces
 * backward in X — the parametric curve is NOT guaranteed monotonic just
 * because its control points are. That overshoot reads as a self-crossing
 * loop in the rendered tube. Dropping intermediate points closer than this
 * to the previous kept point removes the tight cluster that triggers the
 * overshoot, without measurably changing the curve's overall shape (the
 * dropped points differ from their neighbor by a few days out of the whole
 * project timeline).
 */
const PROJECTED_MIN_X_GAP = X_SPAN * 0.03;

/** Drop points too close in X to the previously-kept one (first/last always kept). */
function mergeCloseX(
  points: THREE.Vector3[],
  minGapX: number
): THREE.Vector3[] {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (points[i].x - result[result.length - 1].x < minGapX) continue;
    result.push(points[i]);
  }
  result.push(points[points.length - 1]);
  return result;
}

export function rebuildProjectedCurve(
  controlPoints: THREE.Vector3[]
): THREE.CatmullRomCurve3 {
  const smoothed = mergeCloseX(
    controlPoints.map((p) => p.clone()),
    PROJECTED_MIN_X_GAP
  );
  return new THREE.CatmullRomCurve3(
    ensurePair(smoothed),
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
    const c = cascaded[i];
    const x = dateToX(c.projectedEnd, scale);
    const height = pctToY(progressPct(w, i, total));
    return new THREE.Vector3(x, height, 0);
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
 * Canonical "where is date X on this rendered curve" lookup — the single
 * source of truth both delay shards and the scrub playhead must use so they
 * never disagree. Bisects on curve X (monotonic by construction: control
 * points are ordered by date) rather than lerping the raw control-point
 * polyline, so the result sits exactly on the visible Catmull-Rom tube.
 */
export function curvePointAtX(
  curve: THREE.CatmullRomCurve3,
  targetX: number
): { position: THREE.Vector3; tangent: THREE.Vector3; t: number } {
  const xAt = (t: number) => curve.getPoint(t).x;
  const x0 = xAt(0);
  const x1 = xAt(1);
  if (targetX <= x0) {
    return { position: curve.getPoint(0), tangent: curve.getTangent(0).normalize(), t: 0 };
  }
  if (targetX >= x1) {
    return { position: curve.getPoint(1), tangent: curve.getTangent(1).normalize(), t: 1 };
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (xAt(mid) < targetX) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return { position: curve.getPoint(t), tangent: curve.getTangent(t).normalize(), t };
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
  recoveries: Record<string, number>,
  /**
   * The scene's stable date→X scale. Must be passed once the timeline's
   * projected end can move: rebuilding the scale from a shortened projected
   * end re-normalises every date, so a recovered path would re-stretch to the
   * full span and end at the same X it started at — the axis rail and its
   * ticks (built once) would then disagree with the curve about what date a
   * given X is, and taking a route would never visibly shorten the path.
   */
  fixedScale?: TimelineScale
): THREE.Vector3[] | null {
  const active = Object.entries(recoveries).filter(([, d]) => d > 0);
  if (active.length === 0) return null;

  const scale =
    fixedScale ??
    buildTimelineScale({
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
  return truncateAtFullCompletion(controls);
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
  const pts = truncateAtFullCompletion(
    mergeCloseX(
      [shardPosition.clone(), ...targets.map((p) => p.clone())],
      PROJECTED_MIN_X_GAP
    )
  );
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
      criticalPath: [],
      projectedSegments: [],
      milestones: [],
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
  const plannedPoints = truncateAtFullCompletion([
    plannedStartPt,
    ...waypoints.map((w, i) => {
      return new THREE.Vector3(
        dateToX(w.plannedEnd, timelineScale),
        pctToY(plannedPct(w, i, waypoints.length)),
        0
      );
    }),
  ]);

  // Journey control points begin with a synthetic anchor at timeline.start so
  // the glossy tube's first vertex lines up with the "START" label / axis rail
  // (both at x = dateToX(start) = 0), not with the first waypoint's end date.
  const fullJourneyPoints = truncateAtFullCompletion([
    new THREE.Vector3(dateToX(timeline.start, timelineScale), pctToY(0), 0),
    ...buildJourneyPoints(waypoints, cascaded, timelineScale),
  ]);
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
      const raw = fullJourneyPoints[ptIndex];
      const hit = curvePointAtX(actualCurve, raw.x);
      curveT = hit.t;
      position = hit.position;
      tangent = hit.tangent;
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
  const criticalPath = computeCriticalPath(waypoints).map((entry) => {
    const point = curvePointAtX(projectedCurve, dateToX(entry.waypoint.projectedEnd, timelineScale));
    return { ...entry, position: point.position };
  });
  const projectedSegments = waypoints.flatMap((waypoint, waypointIndex) => {
    if (parseTime(waypoint.plannedEnd) <= asOfMs) return [];
    const previous = waypoints[waypointIndex - 1];
    const startIso = previous && parseTime(previous.plannedEnd) > asOfMs
      ? previous.projectedEnd
      : todayIso;
    const critical = criticalPath[waypointIndex]?.isCritical ?? false;
    return [{
      waypointIndex,
      startX: dateToX(startIso, timelineScale),
      endX: dateToX(waypoint.projectedEnd, timelineScale),
      isCritical: critical,
    }];
  });
  const milestones = waypoints.flatMap((waypoint, waypointIndex) => {
    if (!waypoint.milestone) return [];
    const curve = parseTime(waypoint.plannedEnd) <= asOfMs ? actualCurve : projectedCurve;
    const point = curvePointAtX(curve, dateToX(waypoint.projectedEnd, timelineScale));
    return [{
      waypoint,
      waypointIndex,
      state: parseTime(waypoint.plannedEnd) <= asOfMs ? "reached" as const : "upcoming" as const,
      position: point.position,
    }];
  });
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
    ...milestones.map((m) => m.position),
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
    criticalPath,
    projectedSegments,
    milestones,
    todayWaypointIndex,
    todayIso,
    todayPosition: todaySample.position.clone(),
    todayTangent: todaySample.tangent.clone(),
    timelineScale,
    timeline,
    bounds,
  };
}
