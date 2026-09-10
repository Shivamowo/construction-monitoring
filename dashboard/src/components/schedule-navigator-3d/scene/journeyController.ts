import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import type {
  DelayCategory,
  DelaySeverity,
  NavigatorWaypoint,
  ScheduleNavigatorPayload,
} from "@/lib/schedule-navigator/aggregate";
import {
  buildCatchUpProjectedControls,
  computeCriticalPath,
  buildNavigatorPathModel,
  buildRoutePreviewPoints,
  computeCascadedSchedule,
  curvePointAtX,
  rebuildProjectedCurve,
  recoveryDaysForWaypoint,
  type ShardCluster,
  type NavigatorPathModel,
} from "./pathFromWaypoints";
import {
  createActualTube,
  createClusterShard,
  createCriticalPathAccentTube,
  createCriticalPathMarker,
  CRITICAL_MARKER_Y_OFFSET,
  createForecastShard,
  createGhostRouteLine,
  createOrUpdateProjectedTube,
  createOrUpdateTakenRouteTube,
  createPlannedTube,
  createProjectedDashLine,
  createRoutePreviewLine,
  createTodayMarker,
  createMilestoneMarker,
  routePreviewLiftAt,
  updateCriticalPathAccentTube,
  updateProjectedDashLine,
  updateRoutePreviewLine,
} from "./pathMeshes";

/** Vertical clearance between the route-preview label chip and the (now
 * lifted) preview tube it rides above — independent of the tube's own
 * ROUTE_PREVIEW_Y_LIFT ramp, added on top of it via routePreviewLiftAt. */
const ROUTE_PREVIEW_LABEL_CLEARANCE = 0.18;
import {
  buildAxisAnchors,
  buildPctAxisAnchors,
  createAxisRail,
  createKeyTick,
  createPctAxisRail,
  createPlayheadElement,
  dateToX,
  formatDay,
  monthlyTickMs,
  mountAxisLabelElements,
  mountPctLabelElements,
  mountRouteLabelElement,
  pctToY,
  syncAllProjectedLabels,
  syncPlayheadLabel,
  updateLabelWorldFromRoot,
  type ScreenLabel,
} from "./timelineAxis";
import {
  clampScrubIso,
  fractionToScrubIso,
  formatScrubDay,
} from "@/lib/schedule-navigator/scrubSnapshot";

gsap.registerPlugin(CustomEase);

/** Shared easing vocabulary — every tween uses one of these. */
const EASE = {
  entrance: "power3.out",
  pop: "back.out(1.6)",
  catchup: "power2.inOut",
  card: "expo.out",
  magnetic: "power3.out",
  camera: "power3.inOut",
} as const;

/** Organic yaw path — slight speed changes, not a perfect sine loop. */
const ORGANIC_YAW = CustomEase.create(
  "navOrganicYaw",
  "M0,0 C0.12,0.02 0.22,0.85 0.38,0.62 0.52,0.4 0.58,0.08 0.72,0.28 0.86,0.48 0.94,0.95 1,1"
);

const CATCHUP_DURATION = 2.4;

export interface ClusterSelectPayload {
  cluster: ShardCluster;
  clusterIndex: number;
  representative: NavigatorWaypoint;
  items: NavigatorWaypoint[];
}

export interface JourneyCallbacks {
  onClusterSelect: (payload: ClusterSelectPayload) => void;
  /** Fired when a predicted-risk (forecast) shard on the projected line is clicked. */
  onForecastSelect?: (waypoint: NavigatorWaypoint) => void;
  /** Fired when an alternate-route line (not the delay indicator) is clicked. */
  onRouteSelect?: (waypoint: NavigatorWaypoint) => void;
  onSceneReady?: () => void;
  onCatchUpComplete?: (payload: {
    waypointId: string;
    daysRecovered: number;
    daysLost: number;
    appliedCount: number;
    projectedEnd: string;
    daysBehind: number;
  }) => void;
  /** Fired when the scrub playhead date changes (inspection only — no geometry hide). */
  onScrubChange?: (iso: string) => void;
}

export interface JourneyControllerOptions {
  waypoints: NavigatorWaypoint[];
  timeline: ScheduleNavigatorPayload["timeline"];
  /** DOM host for screen-projected axis labels (inside the viewport). */
  axisOverlay: HTMLElement;
  axisClassNames: {
    month: string;
    key: string;
    today: string;
    title: string;
    sub: string;
    /** Dedicated playhead handle class from React. */
    playhead: string;
  };
}

export interface JourneyController {
  setSize: (width: number, height: number) => void;
  dispose: () => void;
  /** Commit an alternate route: morph the real projected path onto it. */
  applyCatchUpPlan: (waypointId: string) => void;
  resetCatchUpPlan: () => void;
  /** Dolly the camera toward/away from its current target, clamped. */
  zoomIn: () => void;
  zoomOut: () => void;
  /** Enable shard hover hit-testing (pointer cursor + brighten). */
  setHoverEnabled: (active: boolean) => void;
  setShardFilter: (filter: { categories: DelayCategory[]; severities: DelaySeverity[] }) => void;
  /** Toggle the critical-path accent tube + diamond markers on/off. Default
   * off — same opt-in pattern as setShardFilter, .visible-only, no effect
   * on base tubes/shards/milestones. */
  setCriticalPathVisible: (enabled: boolean) => void;
  /** Move inspection playhead; does not hide/reveal path geometry. */
  setScrubIso: (iso: string, opts?: { reframe?: boolean }) => void;
  setScrubbing: (active: boolean) => void;
  getScrubIso: () => string;
  /**
   * Project the currently selected delay shard's screen position (dev px within
   * the viewport). Returns null when nothing is selected. Used to anchor the
   * detail card as a popover near its subject instead of a fixed corner panel.
   */
  getShardScreenAnchor: () => { x: number; y: number; onScreen: boolean } | null;
  /**
   * Project a given alternate-route's midpoint (the same point its DOM
   * label anchors to) to screen space, for popover anchoring — same purpose
   * as getShardScreenAnchor but for the route-preview card.
   */
  getRouteScreenAnchor: (
    waypointId: string
  ) => { x: number; y: number; onScreen: boolean } | null;
  shardCount: number;
  clusterCount: number;
  todayWaypointIndex: number;
  todayIso: string;
}

export function createJourneyController(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  options: JourneyControllerOptions,
  callbacks: JourneyCallbacks
): JourneyController {
  const model = buildNavigatorPathModel({
    waypoints: options.waypoints,
    timeline: options.timeline,
  });

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xf7f0e5, 0.008);

  // Glass reflections for MeshPhysicalMaterial clearcoat — tuned for the light backdrop.
  // A neutral studio environment gives the tubes visible specular highlights that a flat
  // cream background would otherwise wash out.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(38, width / Math.max(height, 1), 0.1, 200);
  const frame = computeCinematicFrame(model);
  // First mount only — instant place; all later camera motion is GSAP.
  camera.position.copy(frame.camPos);
  camera.lookAt(frame.target);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  // Weighted orbit: slower rotate + heavier damping (less twitchy).
  controls.dampingFactor = 0.072;
  controls.rotateSpeed = 0.42;
  controls.enableZoom = true;
  controls.zoomSpeed = 0.6;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI * 0.3;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.target.copy(frame.target);
  // Clamp so zoom can't clip through path geometry or pull back to nothing
  // useful. Bounds cover both the cinematic idle frame and the closer
  // reframe-on-scrub/shard-click camera distance so neither fights zoom.
  const scrubReframeDistance = new THREE.Vector3(6.5, 7.2, 11.5).length();
  const cinematicDistance = frame.camPos.distanceTo(frame.target);
  const zoomBaseDistance = Math.max(scrubReframeDistance, cinematicDistance);
  controls.minDistance = zoomBaseDistance * 0.45;
  controls.maxDistance = zoomBaseDistance * 1.9;
  controls.update();

  scene.add(new THREE.AmbientLight(0xfff6ea, 0.42));
  const key = new THREE.DirectionalLight(0xfff3e2, 1.55);
  key.position.set(10, 22, 11);
  scene.add(key);
  const kicker = new THREE.DirectionalLight(0xffffff, 0.65);
  kicker.position.set(-9, 16, 9);
  scene.add(kicker);
  const fill = new THREE.DirectionalLight(0xf0e6d8, 0.5);
  fill.position.set(-10, 6, -10);
  scene.add(fill);

  const root = new THREE.Group();
  root.name = "navigator-root";
  root.scale.setScalar(0.97);
  scene.add(root);

  const plannedMesh = createPlannedTube(model.plannedCurve);
  root.add(plannedMesh);

  const actualMesh = createActualTube(model.actualCurve);
  root.add(actualMesh);

  let projectedMesh = createOrUpdateProjectedTube(model.projectedCurve);
  root.add(projectedMesh);
  const projectedDash = createProjectedDashLine(model.projectedCurve);
  root.add(projectedDash);

  // Ghosts of superseded projected-path states, one per commit, never removed.
  const ghostLines: THREE.Line[] = [];

  // Once any route is taken, the entire forward path becomes the confident
  // "confirmed" blue tube instead of the amber "at risk" one — rebuilt in
  // place on every subsequent commit (including compounding morphs).
  let takenMesh: THREE.Mesh | null = null;
  let routeTakenActive = false;

  const todayMarker = createTodayMarker(model.todayPosition, model.todayTangent);
  todayMarker.scale.setScalar(0.97);
  root.add(todayMarker);

  const clusterGroups = model.clusters.map((cluster) => {
    const g = createClusterShard(cluster);
    g.scale.setScalar(0.97);
    const ring = g.userData.ring as THREE.Mesh | undefined;
    if (ring) ring.visible = false;
    root.add(g);
    return g;
  });

  // Predicted-risk shards on the projected line — hollow/wireframe, distinct
  // from the solid filled crystals used for delays that already happened.
  const forecastGroups = model.forecastShards.map((forecast) => {
    const g = createForecastShard({
      id: forecast.waypoint.id,
      position: forecast.position,
      tangent: forecast.tangent,
    });
    g.scale.setScalar(0.97);
    root.add(g);
    return g;
  });

  let shardFilter: { categories: DelayCategory[]; severities: DelaySeverity[] } = {
    categories: [],
    severities: [],
  };
  const matchesShardFilter = (waypoint: NavigatorWaypoint) => {
    const category = waypoint.delayCategory ?? "other";
    const severity = waypoint.forecastRisk
      ? waypoint.forecastRisk.riskLevel === "elevated" ? "severe" : "mild"
      : waypoint.severity;
    const matches = (
      (shardFilter.categories.length === 0 || shardFilter.categories.includes(category)) &&
      (shardFilter.severities.length === 0 || shardFilter.severities.includes(severity))
    );
    return matches;
  };
  function applyShardFilter() {
    clusterGroups.forEach((group, index) => {
      group.visible = model.clusters[index].items.some((item) => matchesShardFilter(item.waypoint));
    });
    forecastGroups.forEach((group, index) => {
      group.visible = matchesShardFilter(model.forecastShards[index].waypoint);
    });
  }

  // Default OFF — critical-path visuals (accent tube + diamond markers) are
  // opt-in via a toggle chip, same mechanism as the shard category/severity
  // filters below. Milestones are unaffected and always visible.
  let criticalPathVisualsEnabled = false;

  function segmentPoints(segment: { startX: number; endX: number }) {
    return Array.from({ length: 18 }, (_, index) => {
      const x = THREE.MathUtils.lerp(segment.startX, segment.endX, index / 17);
      return curvePointAtX(model.projectedCurve, x).position;
    });
  }

  // One entry per projected segment, aligned by index; only critical
  // segments carry a mesh — slack segments get no overlay at all. The array
  // itself stays a fixed size (mirroring model.projectedSegments) so
  // refreshCriticalMarkers can create/dispose meshes in place as
  // segments flip between critical and slack after a route commit.
  const criticalAccentTubes: { mesh: THREE.Mesh | null }[] =
    model.projectedSegments.map((segment) => {
      if (!segment.isCritical) return { mesh: null };
      const mesh = createCriticalPathAccentTube(segmentPoints(segment));
      mesh.visible = criticalPathVisualsEnabled;
      root.add(mesh);
      return { mesh };
    });

  const criticalGroups = model.criticalPath.map((critical) => {
    const g = createCriticalPathMarker({
      id: critical.waypoint.id,
      position: critical.position,
      isCritical: critical.isCritical,
    });
    g.visible = critical.isCritical && criticalPathVisualsEnabled;
    root.add(g);
    return g;
  });

  function applyCriticalPathVisibility() {
    criticalGroups.forEach((group, index) => {
      const isCritical = model.criticalPath[index]?.isCritical ?? false;
      group.visible = isCritical && criticalPathVisualsEnabled;
    });
    criticalAccentTubes.forEach((entry) => {
      if (entry.mesh) entry.mesh.visible = criticalPathVisualsEnabled;
    });
  }

  const milestoneGroups = model.milestones.map((milestone) => {
    const g = createMilestoneMarker({
      id: milestone.waypoint.id,
      position: milestone.position,
      state: milestone.state,
    });
    root.add(g);
    return g;
  });

  function refreshCriticalMarkers() {
    const critical = computeCriticalPath(model.waypoints, appliedRecoveries);
    const cascaded = computeCascadedSchedule(model.waypoints, appliedRecoveries);
    model.criticalPath = critical.map((entry) => {
      const point = curvePointAtX(
        model.projectedCurve,
        dateToX(entry.waypoint.projectedEnd, model.timelineScale)
      );
      return { ...entry, position: point.position };
    });
    model.projectedSegments = model.waypoints.flatMap((waypoint, waypointIndex) => {
      if (new Date(`${waypoint.plannedEnd}T00:00:00Z`).getTime() <= new Date(`${model.todayIso}T00:00:00Z`).getTime()) return [];
      const previous = model.waypoints[waypointIndex - 1];
      const startIso = previous && new Date(`${previous.plannedEnd}T00:00:00Z`).getTime() > new Date(`${model.todayIso}T00:00:00Z`).getTime()
        ? cascaded[waypointIndex - 1].projectedEnd
        : model.todayIso;
      return [{
        waypointIndex,
        startX: dateToX(startIso, model.timelineScale),
        endX: dateToX(cascaded[waypointIndex].projectedEnd, model.timelineScale),
        isCritical: model.criticalPath[waypointIndex]?.isCritical ?? false,
      }];
    });
    model.projectedSegments.forEach((segment, index) => {
      const entry = criticalAccentTubes[index];
      if (!entry) return;
      if (segment.isCritical) {
        const points = segmentPoints(segment);
        if (entry.mesh) {
          updateCriticalPathAccentTube(entry.mesh, points);
        } else {
          const mesh = createCriticalPathAccentTube(points);
          mesh.visible = criticalPathVisualsEnabled;
          root.add(mesh);
          entry.mesh = mesh;
        }
      } else if (entry.mesh) {
        root.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        (entry.mesh.material as THREE.Material).dispose();
        entry.mesh = null;
      }
    });
    criticalGroups.forEach((group, index) => {
      const next = model.criticalPath[index];
      if (!next) return;
      group.position.copy(next.position);
      group.position.y += CRITICAL_MARKER_Y_OFFSET;
      group.visible = next.isCritical && criticalPathVisualsEnabled;
    });
    model.milestones.forEach((milestone, index) => {
      const curve = milestone.state === "reached" ? model.actualCurve : model.projectedCurve;
      const point = curvePointAtX(
        curve,
        dateToX(milestone.waypoint.projectedEnd, model.timelineScale)
      );
      milestone.position.copy(point.position);
      milestoneGroups[index]?.position.copy(point.position);
    });
  }

  // Visual-only depth-bias: when a shard's actual curve position coincides with
  // the today marker (an in-progress delay pinned at "today") or with another
  // already-placed shard, nudge it forward on Z so both stay independently
  // visible/clickable. Applied to the mesh's local position only — never to
  // model.clusters/.forecastShards, which stay the true curve position used by
  // catch-up math and getShardScreenAnchor now reads the (possibly nudged) mesh
  // position directly, so the click target and detail-card anchor always agree.
  const COINCIDENCE_EPS = 0.12;
  const COINCIDENCE_DEPTH_BIAS = 0.3;
  const placedMarkerPositions: THREE.Vector3[] = [todayMarker.position.clone()];
  const applyCoincidenceDepthBias = (g: THREE.Object3D) => {
    for (const p of placedMarkerPositions) {
      if (g.position.distanceTo(p) < COINCIDENCE_EPS) {
        g.position.z += COINCIDENCE_DEPTH_BIAS;
        break;
      }
    }
    placedMarkerPositions.push(g.position.clone());
  };
  clusterGroups.forEach(applyCoincidenceDepthBias);
  forecastGroups.forEach(applyCoincidenceDepthBias);

  // Timeline axis (WebGL rail + key ticks) — calendar X matches path X
  const scale = model.timelineScale;
  const months = monthlyTickMs(scale);
  const axisRail = createAxisRail(scale, months);
  root.add(axisRail);

  // Vertical % axis — real cumulative-%-complete Y dimension.
  const pctAxisRail = createPctAxisRail(scale);
  root.add(pctAxisRail);
  const pctAnchors = buildPctAxisAnchors(scale);

  const todayX = dateToX(model.todayIso, scale);
  const startX = dateToX(model.timeline.start, scale);
  const plannedEndX = dateToX(model.timeline.end, scale);
  const projectedEndX = dateToX(model.timeline.projectedEnd, scale);

  root.add(createKeyTick(startX, scale, "#9eb0c2", 0.7));
  root.add(createKeyTick(plannedEndX, scale, "#2f7f8f", 0.85));
  root.add(createKeyTick(todayX, scale, "#e8dcc0", 1.35));
  let projectedEndTick: THREE.Mesh | null = null;
  if (model.timeline.projectedEnd !== model.timeline.end) {
    projectedEndTick = createKeyTick(projectedEndX, scale, "#c45a32", 0.95);
    projectedEndTick.name = "projected-end-tick";
    root.add(projectedEndTick);
  }

  const anchors = buildAxisAnchors(
    {
      start: model.timeline.start,
      plannedEnd: model.timeline.end,
      projectedEnd: model.timeline.projectedEnd,
      todayIso: model.todayIso,
      xSpan: scale.xSpan,
    },
    scale
  );

  // --- Scrub playhead (inspection only — never hides path tubes) ---
  let scrubIso = model.todayIso;

  // Canonical "where is date X" lookup for the scrub playhead — same
  // curvePointAtX bisection the delay/forecast shards snap onto, sampling
  // whichever rendered curve (actual vs projected) covers the date, so the
  // playhead can never drift off the visible tube the way the old raw
  // control-point lerp (sampleJourneyAtDate) did.
  function sampleCurveAtDate(iso: string) {
    const targetX = dateToX(iso, scale);
    const curve = iso <= model.todayIso ? model.actualCurve : model.projectedCurve;
    return curvePointAtX(curve, targetX);
  }

  const playheadLocal = new THREE.Vector3(
    dateToX(scrubIso, scale),
    scale.axisY + 0.55,
    scale.axisZ
  );
  const pathCursorLocal = sampleCurveAtDate(scrubIso).position.clone();

  // Slim axis tick + path ring — inspection markers, not geometry gates
  const scrubAxisTick = createKeyTick(
    playheadLocal.x,
    scale,
    "#f4f7fb",
    1.55
  );
  scrubAxisTick.name = "scrub-axis-tick";
  root.add(scrubAxisTick);

  const pathCursorGeo = new THREE.TorusGeometry(0.32, 0.035, 10, 40);
  const pathCursorMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#f4f7fb"),
    emissive: new THREE.Color("#c4d0dc"),
    emissiveIntensity: 0.45,
    metalness: 0.35,
    roughness: 0.3,
    transparent: true,
    opacity: 0.9,
  });
  const pathCursor = new THREE.Mesh(pathCursorGeo, pathCursorMat);
  pathCursor.name = "scrub-path-cursor";
  pathCursor.rotation.x = Math.PI / 2;
  pathCursor.position.copy(pathCursorLocal);
  root.add(pathCursor);

  const screenLabels: ScreenLabel[] = mountAxisLabelElements(
    options.axisOverlay,
    anchors,
    options.axisClassNames,
    (iso) => {
      setScrubIso(iso, { reframe: true });
    }
  );

  // A line's end IS its completion point (its own date at 100%), so its end
  // marker belongs there rather than down on the date rail — anchored on the
  // rail, the line visibly ran on past its own "PLANNED END"/"PROJECTED END"
  // marker (different z, so perspective pulled them apart on screen).
  const endLabelFor = (kind: "plannedEnd" | "projectedEnd") =>
    screenLabels.find((l) => l.el.dataset.kind === kind) ?? null;
  const anchorEndLabelToCurve = (
    kind: "plannedEnd" | "projectedEnd",
    curve: THREE.CatmullRomCurve3
  ) => {
    const label = endLabelFor(kind);
    if (label) label.local.copy(curve.getPoint(1));
  };
  anchorEndLabelToCurve("plannedEnd", model.plannedCurve);
  anchorEndLabelToCurve("projectedEnd", model.projectedCurve);

  const playheadDom = createPlayheadElement(
    options.axisOverlay,
    options.axisClassNames.playhead
  );
  playheadDom.local.copy(playheadLocal);

  // Mounted after the X-axis labels (which clear the overlay container).
  const pctLabels: ScreenLabel[] = mountPctLabelElements(
    options.axisOverlay,
    pctAnchors,
    options.axisClassNames.month
  );

  // One combined array so month/key/% labels all collision-avoid each other
  // uniformly (see syncAllProjectedLabels) instead of two blind, unaware systems.
  const allProjectedLabels: ScreenLabel[] = [...screenLabels, ...pctLabels];

  // Axis endpoints in local space for drag → date mapping
  const axisStartLocal = new THREE.Vector3(0, scale.axisY + 0.55, scale.axisZ);
  const axisEndLocal = new THREE.Vector3(
    scale.xSpan,
    scale.axisY + 0.55,
    scale.axisZ
  );
  const axisStartWorld = new THREE.Vector3();
  const axisEndWorld = new THREE.Vector3();
  const ndcScratch = new THREE.Vector3();

  let scrubbing = false;
  const camTweenProxy = {
    camX: camera.position.x,
    camY: camera.position.y,
    camZ: camera.position.z,
    tx: controls.target.x,
    ty: controls.target.y,
    tz: controls.target.z,
  };

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoverEnabled = false;
  let hoveredClusterIndex = -1;
  let hoveredForecastIndex = -1;
  let morphing = false;
  let selectedClusterIndex = -1;
  let selectedForecastIndex = -1;
  let viewW = width;
  let viewH = height;

  /** Compounded recoveries across shards — later plans add, never replace. */
  const appliedRecoveries: Record<string, number> = {};

  // --- GSAP camera: idle drift driven by tweened proxy, not render-loop lerp ---
  const driftProxy = { yaw: 0, pitch: 0, radiusBoost: 0 };
  let idleTl: gsap.core.Timeline | null = null;
  let pitchTween: gsap.core.Tween | null = null;
  let userOrbiting = false;
  let idleActive = true;

  const baseCam = frame.camPos.clone();
  const baseTarget = frame.target.clone();
  const scratchRel = new THREE.Vector3();
  const scratchPos = new THREE.Vector3();

  function applyIdleCameraFromProxy() {
    scratchRel.copy(baseCam).sub(baseTarget);
    const cos = Math.cos(driftProxy.yaw);
    const sin = Math.sin(driftProxy.yaw);
    const x = scratchRel.x * cos - scratchRel.z * sin;
    const z = scratchRel.x * sin + scratchRel.z * cos;
    const len = Math.hypot(x, scratchRel.y, z);
    const boosted = len + driftProxy.radiusBoost;
    const scale = len > 1e-6 ? boosted / len : 1;
    scratchPos.set(x * scale, scratchRel.y * scale + driftProxy.pitch * 4.2, z * scale);
    scratchPos.add(baseTarget);
    camera.position.copy(scratchPos);
    controls.target.copy(baseTarget);
  }

  function killIdleTweens() {
    idleTl?.kill();
    idleTl = null;
    pitchTween?.kill();
    pitchTween = null;
    gsap.killTweensOf(driftProxy);
  }

  function startIdleDrift(fromCurrent = false) {
    killIdleTweens();
    if (!idleActive || morphing) return;

    if (fromCurrent) {
      // Soft handoff after orbit: ease proxy toward a fresh cycle start.
      gsap.to(driftProxy, {
        yaw: 0,
        pitch: 0,
        radiusBoost: 0,
        duration: 1.1,
        ease: EASE.camera,
        onUpdate: applyIdleCameraFromProxy,
        onComplete: () => beginIdleLoop(),
      });
    } else {
      driftProxy.yaw = 0;
      driftProxy.pitch = 0;
      driftProxy.radiusBoost = 0;
      beginIdleLoop();
    }
  }

  function beginIdleLoop() {
    killIdleTweens();
    if (!idleActive || morphing || userOrbiting) return;

    // Asymmetric yaw segments + CustomEase = gentle arc, not GIF-loop uniform.
    idleTl = gsap.timeline({
      repeat: -1,
      onUpdate: applyIdleCameraFromProxy,
    });
    idleTl
      .to(driftProxy, { yaw: 0.32, duration: 8.4, ease: ORGANIC_YAW })
      .to(driftProxy, { yaw: -0.18, duration: 10.2, ease: "sine.inOut" })
      .to(driftProxy, { yaw: 0.14, duration: 7.1, ease: ORGANIC_YAW })
      .to(driftProxy, { yaw: -0.06, duration: 6.6, ease: "sine.inOut" })
      .to(driftProxy, { yaw: 0, duration: 5.8, ease: ORGANIC_YAW });

    pitchTween = gsap.to(driftProxy, {
      pitch: 0.045,
      radiusBoost: 0.55,
      duration: 12.5,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut",
      onUpdate: applyIdleCameraFromProxy,
    });
  }

  function pauseIdleForOrbit() {
    killIdleTweens();
  }

  function flyToFocus(focusLocal: THREE.Vector3) {
    const focus = focusLocal.clone().applyMatrix4(root.matrixWorld);
    const target = focus.clone().add(new THREE.Vector3(0, 0.3, 0));
    const camPos = focus.clone().add(new THREE.Vector3(-4.8, 4.6, 8.8));

    idleActive = false;
    killIdleTweens();
    gsap.killTweensOf(camTweenProxy);
    camTweenProxy.camX = camera.position.x;
    camTweenProxy.camY = camera.position.y;
    camTweenProxy.camZ = camera.position.z;
    camTweenProxy.tx = controls.target.x;
    camTweenProxy.ty = controls.target.y;
    camTweenProxy.tz = controls.target.z;

    gsap.to(camTweenProxy, {
      camX: camPos.x,
      camY: camPos.y,
      camZ: camPos.z,
      tx: target.x,
      ty: target.y,
      tz: target.z,
      duration: 1.05,
      ease: EASE.camera,
      overwrite: true,
      onUpdate: () => {
        camera.position.set(camTweenProxy.camX, camTweenProxy.camY, camTweenProxy.camZ);
        controls.target.set(camTweenProxy.tx, camTweenProxy.ty, camTweenProxy.tz);
        controls.update();
      },
    });
  }

  controls.addEventListener("start", () => {
    userOrbiting = true;
    pauseIdleForOrbit();
  });
  controls.addEventListener("end", () => {
    userOrbiting = false;
    baseCam.copy(camera.position);
    baseTarget.copy(controls.target);
    if (idleActive && !morphing) {
      startIdleDrift(true);
    }
  });

  function rebuildProjectedFromControls() {
    model.projectedCurve = rebuildProjectedCurve(model.projectedControlPoints);
    if (routeTakenActive) {
      takenMesh = createOrUpdateTakenRouteTube(model.projectedCurve, takenMesh);
      if (!takenMesh.parent) root.add(takenMesh);
      projectedMesh.visible = false;
      projectedDash.visible = false;
    } else {
      projectedMesh = createOrUpdateProjectedTube(
        model.projectedCurve,
        projectedMesh
      );
      updateProjectedDashLine(projectedDash, model.projectedCurve);
    }
  }

  function findClusterIndexFromObject(obj: THREE.Object3D): number {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      const id = cur.userData?.clusterId as string | undefined;
      if (id) {
        const idx = model.clusters.findIndex((c) => c.id === id);
        if (idx >= 0) return idx;
      }
      cur = cur.parent;
    }
    return -1;
  }

  function findForecastIndexFromObject(obj: THREE.Object3D): number {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      const id = cur.userData?.forecastId as string | undefined;
      if (id) {
        const idx = model.forecastShards.findIndex((f) => f.waypoint.id === id);
        if (idx >= 0) return idx;
      }
      cur = cur.parent;
    }
    return -1;
  }

  function onPointerDown(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const targets: THREE.Object3D[] = [];
    clusterGroups.forEach((g) => {
      if (g.visible) g.traverse((o) => targets.push(o));
    });
    forecastGroups.forEach((g) => {
      if (g.visible) g.traverse((o) => targets.push(o));
    });
    alternateRoutes.forEach((a) => {
      if (a.line.visible) targets.push(a.line);
    });
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return;

    const routeEntry = findAlternateRouteFromObject(hits[0].object);
    if (routeEntry) {
      const wp = model.waypoints.find((w) => w.id === routeEntry.waypointId);
      // Use the source centerline points, not raw geometry vertices — the
      // preview is a TubeGeometry mesh now, so its "position" attribute is
      // tube-surface (ring-of-vertices) data, not points along the curve.
      // Points are raw (unlifted); add the same eased lift the mesh's own
      // geometry bakes in so the camera frames where the tube actually is.
      if (routeEntry.points.length) {
        const midIndex = Math.floor(routeEntry.points.length / 2);
        const focus = routeEntry.points[midIndex].clone();
        focus.y += routePreviewLiftAt(routeEntry.points, midIndex);
        routeEntry.line.localToWorld(focus);
        root.worldToLocal(focus);
        flyToFocus(focus);
      }
      if (wp) callbacks.onRouteSelect?.(wp);
      return;
    }

    const forecastIndex = findForecastIndexFromObject(hits[0].object);
    if (forecastIndex >= 0) {
      selectedForecastIndex = forecastIndex;
      selectedClusterIndex = -1;
      flyToFocus(model.forecastShards[forecastIndex].position);
      callbacks.onForecastSelect?.(model.forecastShards[forecastIndex].waypoint);
      return;
    }

    const clusterIndex = findClusterIndexFromObject(hits[0].object);
    if (clusterIndex < 0) return;

    selectedClusterIndex = clusterIndex;
    selectedForecastIndex = -1;
    const cluster = model.clusters[clusterIndex];
    flyToFocus(cluster.position);
    callbacks.onClusterSelect({
      cluster,
      clusterIndex,
      representative: cluster.representative.waypoint,
      items: cluster.items.map((it) => it.waypoint),
    });
  }

  function onPointerMove(event: PointerEvent) {
    if (!hoverEnabled) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const targets: THREE.Object3D[] = [];
    clusterGroups.forEach((g) => g.traverse((o) => targets.push(o)));
    forecastGroups.forEach((g) => g.traverse((o) => targets.push(o)));
    alternateRoutes.forEach((a) => {
      if (a.line.visible) targets.push(a.line);
    });
    const hits = raycaster.intersectObjects(targets, false);
    const hitObj = hits.length > 0 ? hits[0].object : null;
    hoveredClusterIndex = hitObj ? findClusterIndexFromObject(hitObj) : -1;
    hoveredForecastIndex = hitObj ? findForecastIndexFromObject(hitObj) : -1;
    const hoveredRoute = hitObj ? findAlternateRouteFromObject(hitObj) : null;
    canvas.style.cursor =
      hoveredClusterIndex >= 0 || hoveredForecastIndex >= 0 || hoveredRoute
        ? "pointer"
        : "grab";
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);

  let raf = 0;
  let disposed = false;

  const tick = () => {
    if (disposed) return;
    controls.update();

    // Today marker is a quiet static ink stamp — no breathing/glow
    clusterGroups.forEach((group, i) => {
      if (!group.visible) return;
      const crystal = group.userData.crystal as THREE.Mesh;
      const ring = group.userData.ring as THREE.Mesh;
      const crystalMat = group.userData.crystalMat as THREE.MeshPhysicalMaterial;
      const ringMat = group.userData.ringMat as THREE.MeshBasicMaterial;

      const isHover = i === hoveredClusterIndex;
      const isSelected = i === selectedClusterIndex;

      // Quiet selected state — no emissive glow, no pulse
      crystalMat.emissiveIntensity = 0;
      crystal.scale.setScalar(isHover ? 1.08 : isSelected ? 1.04 : 1);

      // Static soft ring on hover/active only — no repeating or one-shot pulse,
      // and never a blown-out halo: modest scale, low opacity.
      if (isHover || isSelected) {
        ring.visible = true;
        ring.scale.set(1.12, 1.12, 1.12);
        ringMat.opacity = isHover ? 0.22 : 0.16;
      } else {
        ring.visible = false;
        ringMat.opacity = 0;
      }
    });

    forecastGroups.forEach((group, i) => {
      const crystal = group.userData.crystal as THREE.Mesh;
      const ring = group.userData.ring as THREE.Mesh;
      const ringMat = group.userData.ringMat as THREE.MeshBasicMaterial;

      const isHover = i === hoveredForecastIndex;
      const isSelected = i === selectedForecastIndex;
      crystal.scale.setScalar(isHover ? 1.08 : isSelected ? 1.04 : 1);

      if (isHover || isSelected) {
        ring.visible = true;
        ring.scale.set(1.12, 1.12, 1.12);
        ringMat.opacity = isHover ? 0.2 : 0.14;
      } else {
        ring.visible = false;
        ringMat.opacity = 0;
      }
    });

    updateLabelWorldFromRoot(allProjectedLabels, root);
    syncAllProjectedLabels(allProjectedLabels, camera, viewW, viewH);

    playheadDom.local.set(
      dateToX(scrubIso, scale),
      scale.axisY + 0.55,
      scale.axisZ
    );
    updateLabelWorldFromRoot([playheadDom], root);
    syncPlayheadLabel(
      playheadDom,
      camera,
      viewW,
      viewH,
      formatScrubDay(scrubIso)
    );

    // Keep axis screen endpoints fresh for drag mapping
    axisStartWorld.copy(axisStartLocal).applyMatrix4(root.matrixWorld);
    axisEndWorld.copy(axisEndLocal).applyMatrix4(root.matrixWorld);

    composer.render();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  requestAnimationFrame(() => {
    // Understated entrance: slight scale + fade feel via short ease (no pop)
    const entrance = gsap.timeline({
      defaults: { ease: "power2.out" },
      onComplete: () => {
        callbacks.onSceneReady?.();
        startIdleDrift(false);
      },
    });
    entrance.fromTo(
      root.scale,
      { x: 0.97, y: 0.97, z: 0.97 },
      { x: 1, y: 1, z: 1, duration: 0.7 },
      0
    );
    entrance.to(
      todayMarker.scale,
      { x: 1, y: 1, z: 1, duration: 0.55, ease: "power2.out" },
      0.15
    );
    clusterGroups.forEach((g, i) => {
      entrance.to(
        g.scale,
        { x: 1, y: 1, z: 1, duration: 0.45, ease: "power2.out" },
        0.2 + i * 0.04
      );
    });
    forecastGroups.forEach((g, i) => {
      entrance.to(
        g.scale,
        { x: 1, y: 1, z: 1, duration: 0.45, ease: "power2.out" },
        0.24 + i * 0.05
      );
    });
  });

  function applyScrubVisuals(iso: string) {
    const x = dateToX(iso, scale);
    scrubAxisTick.position.x = x;
    playheadLocal.set(x, scale.axisY + 0.55, scale.axisZ);
    playheadDom.local.copy(playheadLocal);

    const sample = sampleCurveAtDate(iso);
    pathCursor.position.copy(sample.position);
    // Orient torus to sit on path (flat-ish relative to up)
    pathCursor.quaternion.identity();
    pathCursor.rotation.x = Math.PI / 2;

    // Projected zone: amber cursor language; actual zone: cool white
    const projected = iso > model.todayIso;
    pathCursorMat.color.set(projected ? "#e87840" : "#f4f7fb");
    pathCursorMat.emissive.set(projected ? "#8a2a18" : "#c4d0dc");
    const tickMat = scrubAxisTick.material as THREE.MeshBasicMaterial;
    tickMat.color.set(projected ? "#e87840" : "#f4f7fb");
  }

  function reframeCameraToScrub(iso: string) {
    const sample = sampleCurveAtDate(iso);
    const focus = sample.position.clone();
    const target = focus.clone().add(new THREE.Vector3(0, 0.35, 0));
    const camPos = new THREE.Vector3(
      focus.x - 6.5,
      focus.y + 7.2,
      focus.z + 11.5
    );

    idleActive = false;
    killIdleTweens();
    gsap.killTweensOf(camTweenProxy);

    camTweenProxy.camX = camera.position.x;
    camTweenProxy.camY = camera.position.y;
    camTweenProxy.camZ = camera.position.z;
    camTweenProxy.tx = controls.target.x;
    camTweenProxy.ty = controls.target.y;
    camTweenProxy.tz = controls.target.z;

    gsap.to(camTweenProxy, {
      camX: camPos.x,
      camY: camPos.y,
      camZ: camPos.z,
      tx: target.x,
      ty: target.y,
      tz: target.z,
      duration: scrubbing ? 0.28 : 0.65,
      ease: EASE.camera,
      onUpdate: () => {
        camera.position.set(
          camTweenProxy.camX,
          camTweenProxy.camY,
          camTweenProxy.camZ
        );
        controls.target.set(
          camTweenProxy.tx,
          camTweenProxy.ty,
          camTweenProxy.tz
        );
        baseCam.copy(camera.position);
        baseTarget.copy(controls.target);
      },
      onComplete: () => {
        if (!scrubbing && !morphing && !userOrbiting) {
          idleActive = true;
          startIdleDrift(true);
        }
      },
    });
  }

  function setScrubIso(iso: string, opts?: { reframe?: boolean }) {
    const next = clampScrubIso(iso, model.timeline);
    const changed = next !== scrubIso;
    scrubIso = next;
    applyScrubVisuals(scrubIso);
    if (changed) callbacks.onScrubChange?.(scrubIso);
    if (opts?.reframe !== false) reframeCameraToScrub(scrubIso);
  }

  function screenXToScrubIso(clientX: number, rect: DOMRect): string {
    root.updateMatrixWorld(true);
    axisStartWorld.copy(axisStartLocal).applyMatrix4(root.matrixWorld);
    axisEndWorld.copy(axisEndLocal).applyMatrix4(root.matrixWorld);
    const a = ndcScratch.copy(axisStartWorld).project(camera);
    const b = ndcScratch.copy(axisEndWorld).project(camera);
    // Reuse ndcScratch carefully — project mutates; compute both with temps
    const ax = (axisStartWorld.clone().project(camera).x * 0.5 + 0.5) * viewW;
    const bx = (axisEndWorld.clone().project(camera).x * 0.5 + 0.5) * viewW;
    void a;
    void b;
    const localX = clientX - rect.left;
    const span = Math.max(Math.abs(bx - ax), 1);
    const fraction = (localX - Math.min(ax, bx)) / span;
    const ordered = ax <= bx ? fraction : 1 - fraction;
    return fractionToScrubIso(ordered, model.timeline);
  }

  function onPlayheadPointerDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    scrubbing = true;
    idleActive = false;
    killIdleTweens();
    playheadDom.el.setPointerCapture(e.pointerId);
  }

  function onPlayheadPointerMove(e: PointerEvent) {
    if (!scrubbing) return;
    const rect = options.axisOverlay.getBoundingClientRect();
    const iso = screenXToScrubIso(e.clientX, rect);
    setScrubIso(iso, { reframe: true });
  }

  function onPlayheadPointerUp(e: PointerEvent) {
    if (!scrubbing) return;
    scrubbing = false;
    try {
      playheadDom.el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!morphing && !userOrbiting) {
      idleActive = true;
      startIdleDrift(true);
    }
  }

  playheadDom.el.addEventListener("pointerdown", onPlayheadPointerDown);
  playheadDom.el.addEventListener("pointermove", onPlayheadPointerMove);
  playheadDom.el.addEventListener("pointerup", onPlayheadPointerUp);
  playheadDom.el.addEventListener("pointercancel", onPlayheadPointerUp);

  // Initial visuals at today (default — no camera jump on mount beyond cinematic frame)
  applyScrubVisuals(scrubIso);
  callbacks.onScrubChange?.(scrubIso);

  /**
   * Alternate-route lines: one persistent, independently clickable object
   * per delay that has a catch-up plan — built once at scene setup, always
   * visible (not conditional on selecting the delay indicator first). Taking
   * a route hides that specific line (it becomes the committed path instead).
   */
  interface AlternateRouteEntry {
    waypointId: string;
    line: THREE.Mesh;
    /** Source centerline points — geometry vertices are tube-surface, not
     * usable for a midpoint focus lookup, so the curve points are kept
     * alongside the mesh. */
    points: THREE.Vector3[];
    label: ScreenLabel;
  }
  const alternateRoutes: AlternateRouteEntry[] = [];

  function buildAlternateRoutePoints(waypointId: string): THREE.Vector3[] | null {
    const wp = model.waypoints.find((w) => w.id === waypointId);
    const daysRecovered = recoveryDaysForWaypoint(wp);
    if (!wp || daysRecovered <= 0) return null;
    const shard =
      model.shards.find((s) => s.waypoint.id === waypointId) ??
      model.forecastShards.find((s) => s.waypoint.id === waypointId);
    const shardPosition = shard?.position ?? model.todayPosition;
    // Preview this plan ON TOP of everything already committed, so after a
    // commit the remaining routes describe the path you'd actually get from
    // here — not a stale branch off the original baseline.
    const targets = buildCatchUpProjectedControls(
      model.waypoints,
      model.timeline,
      model.todayIso,
      model.todayPosition,
      { ...appliedRecoveries, [waypointId]: daysRecovered },
      scale
    );
    if (targets?.length) {
      flyToFocus(targets[Math.min(2, targets.length - 1)]);
    }
    if (!targets || targets.length < 2) return null;
    return buildRoutePreviewPoints(shardPosition, targets);
  }

  const planBearingIds = [
    ...model.shards.map((s) => s.waypoint.id),
    ...model.forecastShards.map((s) => s.waypoint.id),
  ].filter((id) => recoveryDaysForWaypoint(model.waypoints.find((w) => w.id === id)) > 0);

  for (const waypointId of planBearingIds) {
    const points = buildAlternateRoutePoints(waypointId);
    if (!points) continue;
    const line = createRoutePreviewLine(points);
    line.userData.kind = "alternate-route";
    line.userData.waypointId = waypointId;
    root.add(line);

    const midIndex = Math.floor(points.length / 2);
    const midPoint = points[midIndex]
      .clone()
      .add(
        new THREE.Vector3(
          0,
          routePreviewLiftAt(points, midIndex) + ROUTE_PREVIEW_LABEL_CLEARANCE,
          0
        )
      );
    // DOM label (not a WebGL sprite) so it runs through the SAME
    // syncAllProjectedLabels collision pass as every date/axis label —
    // a separate sprite-based label was the root cause of the undetected
    // "ALTERNATE ROUTE" overlap (two unrelated systems, neither aware of
    // the other's occupied screen space).
    const label = mountRouteLabelElement(
      options.axisOverlay,
      waypointId,
      "Alternate route",
      midPoint,
      { key: options.axisClassNames.key, title: options.axisClassNames.title }
    );
    allProjectedLabels.push(label);

    alternateRoutes.push({ waypointId, line, points, label });
  }

  // Wider hit-test threshold so thin lines are practical raycast targets.
  raycaster.params.Line = { threshold: 0.18 };

  /** Project a local-space point (relative to `root`) to viewport pixels. */
  function projectLocalToScreen(
    localPos: THREE.Vector3
  ): { x: number; y: number; onScreen: boolean } {
    root.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    world.copy(localPos).applyMatrix4(root.matrixWorld);
    const ndc = world.project(camera);
    const behind = ndc.z > 1;
    const x = Math.round((ndc.x * 0.5 + 0.5) * viewW);
    const y = Math.round((-ndc.y * 0.5 + 0.5) * viewH);
    const onScreen =
      !behind && x >= -80 && x <= viewW + 80 && y >= -80 && y <= viewH + 80;
    return { x, y, onScreen };
  }

  function findAlternateRouteFromObject(obj: THREE.Object3D): AlternateRouteEntry | null {
    return alternateRoutes.find((a) => a.line === obj) ?? null;
  }

  function hideAlternateRoute(waypointId: string) {
    const entry = alternateRoutes.find((a) => a.waypointId === waypointId);
    if (entry) {
      entry.line.visible = false;
      // Remove from the DOM and from the shared collision array — otherwise
      // syncAllProjectedLabels keeps re-showing it (it only hides labels
      // that fall off-screen, not ones a caller wants gone for good).
      entry.label.el.remove();
      const idx = allProjectedLabels.indexOf(entry.label);
      if (idx >= 0) allProjectedLabels.splice(idx, 1);
    }
  }

  /**
   * Re-preview every route that is still on offer against the current
   * committed path. Called after each commit so the mechanic is recursive:
   * the new path keeps offering routes for the delays still ahead of it.
   */
  function refreshAlternateRoutes() {
    for (const entry of alternateRoutes) {
      if (!entry.line.visible) continue;
      const points = buildAlternateRoutePoints(entry.waypointId);
      if (!points || points.length < 2) {
        hideAlternateRoute(entry.waypointId);
        continue;
      }
      updateRoutePreviewLine(entry.line, points);
      entry.points = points;
      const midIndex = Math.floor(points.length / 2);
      entry.label.local.copy(
        points[midIndex]
          .clone()
          .add(
            new THREE.Vector3(
              0,
              routePreviewLiftAt(points, midIndex) +
                ROUTE_PREVIEW_LABEL_CLEARANCE,
              0
            )
          )
      );
    }
  }

  function applyCatchUpPlan(waypointId: string) {
    if (morphing) return;
    hideAlternateRoute(waypointId);
    const wp = model.waypoints.find((w) => w.id === waypointId);
    const daysRecovered = recoveryDaysForWaypoint(wp);
    if (!wp || daysRecovered <= 0) {
      const cascadedCurrent = computeCascadedSchedule(model.waypoints, appliedRecoveries);
      const lastCurrent = cascadedCurrent[cascadedCurrent.length - 1];
      callbacks.onCatchUpComplete?.({
        waypointId,
        daysRecovered: 0,
        daysLost: wp?.catchUpPlan?.daysLost ?? 0,
        appliedCount: Object.keys(appliedRecoveries).length,
        projectedEnd: lastCurrent.projectedEnd,
        daysBehind: lastCurrent.cascadeAfter,
      });
      return;
    }

    // Ghost the CURRENT projected path — as it existed right before this
    // commit — before mutating anything. Persists forever; each subsequent
    // commit ghosts its own pre-commit state independently, so earlier
    // ghosts are never lost or overwritten.
    const ghostCurve = rebuildProjectedCurve(
      model.projectedControlPoints.map((p) => p.clone())
    );
    const ghostLine = createGhostRouteLine(ghostCurve);
    root.add(ghostLine);
    ghostLines.push(ghostLine);

    // Compound with any previously applied plans (steel unresolved stays full).
    appliedRecoveries[waypointId] = daysRecovered;

    const cascaded = computeCascadedSchedule(model.waypoints, appliedRecoveries);
    const lastCascaded = cascaded[cascaded.length - 1];
    const newProjectedEndIso = lastCascaded.projectedEnd;
    const newDaysBehind = lastCascaded.cascadeAfter;
    model.timeline.projectedEnd = newProjectedEndIso;
    const targets = buildCatchUpProjectedControls(
      model.waypoints,
      model.timeline,
      model.todayIso,
      model.todayPosition,
      { ...appliedRecoveries },
      scale
    );
    if (!targets || targets.length < 2) {
      callbacks.onCatchUpComplete?.({
        waypointId,
        daysRecovered,
        daysLost: wp.catchUpPlan!.daysLost,
        appliedCount: Object.keys(appliedRecoveries).length,
        projectedEnd: newProjectedEndIso,
        daysBehind: newDaysBehind,
      });
      return;
    }

    while (model.projectedControlPoints.length < targets.length) {
      model.projectedControlPoints.push(
        model.projectedControlPoints[
          model.projectedControlPoints.length - 1
        ].clone()
      );
    }
    model.projectedControlPoints.length = targets.length;

    morphing = true;
    idleActive = false;
    killIdleTweens();

    // Morph from the *current* live path so prior recoveries are preserved.
    const startPts = targets.map((_, i) =>
      (
        model.projectedControlPoints[i] ??
        model.projectedControlPoints[model.projectedControlPoints.length - 1] ??
        model.todayPosition
      ).clone()
    );
    startPts[0].copy(model.todayPosition);

    const projectedLabel = screenLabels.find((l) => l.el.dataset.kind === "projectedEnd");
    const startTickX = projectedEndTick?.position.x ?? dateToX(model.timeline.projectedEnd, scale);
    const targetTickX = dateToX(newProjectedEndIso, scale);

    const state = { t: 0 };
    gsap.killTweensOf(state);
    gsap.to(state, {
      t: 1,
      duration: CATCHUP_DURATION,
      ease: EASE.catchup,
      onUpdate: () => {
        // PERF: rebuild TubeGeometry each frame — intentional simplification
        for (let i = 0; i < targets.length; i++) {
          model.projectedControlPoints[i].lerpVectors(
            startPts[i],
            targets[i],
            state.t
          );
        }
        rebuildProjectedFromControls();

        if (projectedEndTick) {
          projectedEndTick.position.x = THREE.MathUtils.lerp(startTickX, targetTickX, state.t);
        }
        if (projectedLabel) {
          projectedLabel.local.copy(model.projectedCurve.getPoint(1));
        }
      },
      onComplete: () => {
        morphing = false;
        for (let i = 0; i < targets.length; i++) {
          model.projectedControlPoints[i].copy(targets[i]);
        }
        // Lands settled in confident blue, not mid-morph amber.
        routeTakenActive = true;
        rebuildProjectedFromControls();
        refreshCriticalMarkers();

        if (projectedLabel) {
          projectedLabel.el.dataset.iso = newProjectedEndIso;
          projectedLabel.el.dataset.routeTaken = "true";
          const sub = projectedLabel.el.querySelector(`.${options.axisClassNames.sub}`);
          if (sub) sub.textContent = formatDay(newProjectedEndIso);
          projectedLabel.local.copy(model.projectedCurve.getPoint(1));
          projectedLabel.el.setAttribute("aria-label", `Scrub to Projected end, ${formatDay(newProjectedEndIso)}`);
        }
        if (projectedEndTick) {
          projectedEndTick.position.x = targetTickX;
        }

        // The committed path is the new current path: every delay still ahead
        // of it re-offers its own route, previewed against this path (and
        // compounded on top of what's already been committed), so the mechanic
        // repeats instead of ending after one commit.
        refreshAlternateRoutes();

        idleActive = true;
        if (!userOrbiting) startIdleDrift(true);
        callbacks.onCatchUpComplete?.({
          waypointId,
          daysRecovered,
          daysLost: wp.catchUpPlan!.daysLost,
          appliedCount: Object.keys(appliedRecoveries).length,
          projectedEnd: newProjectedEndIso,
          daysBehind: newDaysBehind,
        });
      },
    });
  }

  function resetCatchUpPlan() {
    morphing = false;
    for (const k of Object.keys(appliedRecoveries)) {
      delete appliedRecoveries[k];
    }
    for (let i = 0; i < model.projectedControlPoints.length; i++) {
      model.projectedControlPoints[i].copy(model.projectedControlPointsRest[i]);
    }
    rebuildProjectedFromControls();

    const cascaded = computeCascadedSchedule(model.waypoints);
    const lastCascaded = cascaded[cascaded.length - 1];
    const newProjectedEndIso = lastCascaded.projectedEnd;
    model.timeline.projectedEnd = newProjectedEndIso;
    const targetTickX = dateToX(newProjectedEndIso, scale);
    const projectedLabel = screenLabels.find((l) => l.el.dataset.kind === "projectedEnd");
    if (projectedLabel) {
      projectedLabel.el.dataset.iso = newProjectedEndIso;
      const sub = projectedLabel.el.querySelector(`.${options.axisClassNames.sub}`);
      if (sub) sub.textContent = formatDay(newProjectedEndIso);
      projectedLabel.local.x = targetTickX;
      projectedLabel.el.setAttribute("aria-label", `Scrub to Projected end, ${formatDay(newProjectedEndIso)}`);
    }
    if (projectedEndTick) {
      projectedEndTick.position.x = targetTickX;
    }

    idleActive = true;
    if (!userOrbiting) startIdleDrift(true);
  }

  function dollyBy(factor: number) {
    const offset = camera.position.clone().sub(controls.target);
    const dist = offset.length();
    if (dist < 1e-6) return;
    const nextDist = THREE.MathUtils.clamp(
      dist * factor,
      controls.minDistance,
      controls.maxDistance
    );
    offset.setLength(nextDist);
    camera.position.copy(controls.target).add(offset);
    baseCam.copy(camera.position);
    controls.update();
  }

  function setSize(w: number, h: number) {
    const safeH = Math.max(h, 1);
    viewW = w;
    viewH = safeH;
    camera.aspect = w / safeH;
    camera.updateProjectionMatrix();
    renderer.setSize(w, safeH, false);
    composer.setSize(w, safeH);
  }

  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    killIdleTweens();
    gsap.killTweensOf(camera.position);
    gsap.killTweensOf(controls.target);
    gsap.killTweensOf(driftProxy);
    gsap.killTweensOf(root.scale);
    gsap.killTweensOf(todayMarker.scale);
    clusterGroups.forEach((g) => gsap.killTweensOf(g.scale));
    options.axisOverlay.replaceChildren();
    controls.dispose();
    composer.dispose();
    renderer.dispose();
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
      const sprite = obj as THREE.Sprite;
      if (sprite.material && "map" in sprite.material) {
        const sm = sprite.material as THREE.SpriteMaterial;
        sm.map?.dispose();
        sm.dispose();
      }
    });
  }

  return {
    setSize,
    dispose,
    applyCatchUpPlan,
    resetCatchUpPlan,
    zoomIn: () => dollyBy(0.82),
    zoomOut: () => dollyBy(1.22),
    setHoverEnabled: (active: boolean) => {
      hoverEnabled = active;
      if (!active) {
        hoveredClusterIndex = -1;
        canvas.style.cursor = "grab";
      }
    },
    setShardFilter: (filter) => {
      shardFilter = filter;
      applyShardFilter();
    },
    setCriticalPathVisible: (enabled: boolean) => {
      criticalPathVisualsEnabled = enabled;
      applyCriticalPathVisibility();
    },
    setScrubIso,
    setScrubbing: (active: boolean) => {
      scrubbing = active;
      if (active) {
        idleActive = false;
        killIdleTweens();
      } else if (!morphing && !userOrbiting) {
        idleActive = true;
        startIdleDrift(true);
      }
    },
    getScrubIso: () => scrubIso,
    getShardScreenAnchor: () => {
      // Read the MESH's actual local position (not model.clusters/.forecastShards),
      // so the popover anchors to where the shard is actually rendered — including
      // the today-coincidence depth-bias nudge applied below, which never touches
      // the underlying model data (curve position / curveT / catch-up math).
      const anchorPos =
        selectedClusterIndex >= 0
          ? clusterGroups[selectedClusterIndex]?.position
          : selectedForecastIndex >= 0
            ? forecastGroups[selectedForecastIndex]?.position
            : null;
      if (!anchorPos) return null;
      return projectLocalToScreen(anchorPos);
    },
    getRouteScreenAnchor: (waypointId: string) => {
      const entry = alternateRoutes.find((a) => a.waypointId === waypointId);
      if (!entry || !entry.line.visible || !entry.points.length) return null;
      const midIndex = Math.floor(entry.points.length / 2);
      const anchorPos = entry.points[midIndex].clone();
      anchorPos.y += routePreviewLiftAt(entry.points, midIndex);
      return projectLocalToScreen(anchorPos);
    },
    shardCount: model.shards.length,
    clusterCount: model.clusters.length,
    todayWaypointIndex: model.todayWaypointIndex,
    todayIso: model.todayIso,
  };
}

function computeCinematicFrame(model: NavigatorPathModel) {
  const mid = new THREE.Vector3();
  if (!model.bounds.isEmpty()) model.bounds.getCenter(mid);
  else mid.set(21, 1, 0);

  const size = new THREE.Vector3();
  model.bounds.getSize(size);
  const span = Math.max(size.x, 24);

  const target = mid.clone().setY(mid.y + 0.4);
  // Slightly higher / pulled back so axis labels along the base stay readable
  const camPos = new THREE.Vector3(
    mid.x - span * 0.2,
    mid.y + 9.2,
    mid.z + span * 0.42
  );
  return { camPos, target, span };
}

export { EASE };
