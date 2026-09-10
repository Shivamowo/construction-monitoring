import * as THREE from "three";
import type { ShardCluster } from "./pathFromWaypoints";

const TUBE_RADIUS_ACTUAL = 0.085;
const TUBE_RADIUS_PLANNED = 0.055;
const TUBE_RADIUS_PROJECTED = 0.07;
/** Boldest of all lines — "this is the route you're on now," confident/current. */
const TUBE_RADIUS_TAKEN = 0.1;
/** Visible from afar without competing with the current (taken) path. */
const TUBE_RADIUS_ROUTE_PREVIEW = 0.075;
/**
 * Vertical clearance for the route-preview tube above whatever tube it runs
 * alongside. Must clear preview radius (0.075) + the thickest tube it can
 * sit near — taken route (0.1) — + margin (0.05) = 0.225; rounded up.
 */
const ROUTE_PREVIEW_Y_LIFT = 0.24;
/**
 * Fraction of the way from the branch point to the next control point where
 * a synthetic "kickoff" point is inserted, already at full lift height.
 *
 * A naive per-control-point ease (lift ramping in as a function of control
 * index / point count) turned out NOT to shorten the near-origin low-
 * clearance zone at all — verified numerically: sweeping the ease width
 * across three orders of magnitude left the point where clearance actually
 * crosses the safety threshold pinned at the same curve parameter every
 * time. CatmullRom's tangent at the branch point is shaped by its
 * neighboring control points as a whole, not by how gradually one of them
 * eases in, so a small ease width on control point 1 barely changed the
 * curve's shape near t=0.
 *
 * Inserting an EARLY point already at (near-)full height forces the spline's
 * tangent right after the branch to point steeply upward, which does move
 * the low-clearance zone (numerically confirmed to shrink from ~12% to ~3%
 * of the curve's length for a representative branch).
 */
const ROUTE_PREVIEW_KICKOFF_FRAC = 0.02;
const TUBE_RADIAL = 24;

export function createPlannedTube(
  curve: THREE.CatmullRomCurve3
): THREE.Mesh {
  const tubular = Math.max(96, Math.floor(curve.getLength() * 8));
  const geometry = new THREE.TubeGeometry(
    curve,
    tubular,
    TUBE_RADIUS_PLANNED,
    TUBE_RADIAL,
    false
  );
  /* Glassy warm-graphite planned path — clearcoat for specular on the light backdrop */
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#5c584f"),
    metalness: 0.18,
    roughness: 0.24,
    clearcoat: 0.55,
    clearcoatRoughness: 0.16,
    transparent: true,
    opacity: 0.55,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "planned-path";
  mesh.userData.kind = "planned";
  return mesh;
}

/** Full actual-to-date tube — always complete (no progress gating). */
export function createActualTube(
  curve: THREE.CatmullRomCurve3,
  existing?: THREE.Mesh | null
): THREE.Mesh {
  const tubular = Math.max(80, Math.floor(curve.getLength() * 10));
  const geometry = new THREE.TubeGeometry(
    curve,
    tubular,
    TUBE_RADIUS_ACTUAL,
    TUBE_RADIAL,
    false
  );

  if (existing) {
    existing.geometry.dispose();
    existing.geometry = geometry;
    return existing;
  }

  /* Light theme: rich teal, glassy, shadow-based depth */
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#1f7a6c"),
    metalness: 0.14,
    roughness: 0.22,
    clearcoat: 0.6,
    clearcoatRoughness: 0.14,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "actual-path";
  mesh.userData.kind = "actual";
  return mesh;
}

/**
 * At-risk forecast tube — warm amber/terracotta, dashed appearance via
 * separate dash-line overlay. Solid but slightly translucent.
 *
 * PERF NOTE: catch-up morph calls this every frame to rebuild TubeGeometry
 * from updated control points — known simplification; replace with
 * BufferGeometry morph targets or shader displacement later if needed.
 */
export function createOrUpdateProjectedTube(
  curve: THREE.CatmullRomCurve3,
  existing?: THREE.Mesh | null
): THREE.Mesh {
  const tubular = Math.max(64, Math.floor(curve.getLength() * 8));
  const geometry = new THREE.TubeGeometry(
    curve,
    tubular,
    TUBE_RADIUS_PROJECTED,
    TUBE_RADIAL,
    false
  );

  if (existing) {
    existing.geometry.dispose();
    existing.geometry = geometry;
    return existing;
  }

  /* Light theme: saturated amber, glassy translucency, shadow depth */
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#c98a3a"),
    metalness: 0.12,
    roughness: 0.26,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    clearcoat: 0.5,
    clearcoatRoughness: 0.18,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "projected-path";
  mesh.userData.kind = "projected";
  return mesh;
}

/**
 * "This is the route you're on now" — solid, confident, bright confirmed-blue
 * (Google-Maps-directions blue), NOT a shade/opacity variant of any of the
 * other 4 line colors (graphite planned, teal actual, amber projected, gray
 * preview). Bigger radius than every other line for visual weight/priority.
 * Replaces the amber "at risk" projected tube once at least one route has
 * been taken.
 */
export function createOrUpdateTakenRouteTube(
  curve: THREE.CatmullRomCurve3,
  existing?: THREE.Mesh | null
): THREE.Mesh {
  const tubular = Math.max(64, Math.floor(curve.getLength() * 8));
  const geometry = new THREE.TubeGeometry(
    curve,
    tubular,
    TUBE_RADIUS_TAKEN,
    TUBE_RADIAL,
    false
  );

  if (existing) {
    existing.geometry.dispose();
    existing.geometry = geometry;
    return existing;
  }

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#1a73e8"),
    metalness: 0.05,
    roughness: 0.28,
    clearcoat: 0.35,
    clearcoatRoughness: 0.25,
    // Warm ambient/env light on a cream backdrop washes out cool blues under
    // physical shading — self-emission keeps the hue reading as saturated
    // confident blue instead of a pale periwinkle.
    emissive: new THREE.Color("#1a73e8"),
    emissiveIntensity: 0.45,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "taken-route";
  mesh.userData.kind = "taken-route";
  return mesh;
}

/** Dashed centerline overlay so the forecast reads as provisional. */
export function createProjectedDashLine(
  curve: THREE.CatmullRomCurve3
): THREE.Line {
  const pts = curve.getPoints(80);
  /* Light theme: muted amber dash */
  const geometry = new THREE.BufferGeometry().setFromPoints(pts);
  const material = new THREE.LineDashedMaterial({
    color: new THREE.Color("#c98a3a"),
    dashSize: 0.45,
    gapSize: 0.3,
    transparent: true,
    opacity: 0.6,
    linewidth: 1,
  });
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  line.name = "projected-dash";
  line.userData.kind = "projected-dash";
  line.position.y += 0.015;
  return line;
}

export function updateProjectedDashLine(
  line: THREE.Line,
  curve: THREE.CatmullRomCurve3
): void {
  const pts = curve.getPoints(80);
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  line.computeLineDistances();
}

/**
 * Lift amount (world units) the route-preview line carries at a given
 * source-point index — exported so callers positioning DOM labels/ticks or
 * the camera-focus point against the preview line can match the mesh's
 * actual height instead of reading a stale flat offset. The branch point
 * (index 0, shared with the delay shard) carries no lift; every other
 * source point is fully lifted (the near-origin transition itself is
 * handled by an inserted geometry-only kickoff point — see
 * liftRoutePreviewPoints — which isn't part of the caller-visible index
 * space, so this stays a simple two-value lookup).
 */
export function routePreviewLiftAt(
  _points: THREE.Vector3[],
  index: number
): number {
  return index === 0 ? 0 : ROUTE_PREVIEW_Y_LIFT;
}

/**
 * Lift the route-preview points off the path they branch from. Baked into
 * the point data itself (not a flat mesh.position.y translation).
 *
 * The branch point (index 0, shared with the delay shard) stays unlifted so
 * the preview visibly starts at the shard. Every other source point is
 * fully lifted. Between those two, a synthetic "kickoff" point is inserted
 * a short distance toward the next point, already at full lift height, so
 * the spline's tangent leaving the branch points steeply upward instead of
 * rising gradually across the curve's whole first segment (that gradual
 * version was tried and measured: sweeping an eased ramp on the existing
 * control points left the curve's low-clearance zone unchanged regardless
 * of ramp width, because CatmullRom's near-start tangent is governed by the
 * neighboring control points as a group, not by how gradually one point's
 * height eases in — an extra point forces the shape change directly).
 */
function liftRoutePreviewPoints(points: THREE.Vector3[]): THREE.Vector3[] {
  if (points.length < 2) return points.map((p) => p.clone());
  const [p0, p1] = points;
  const kickoff = new THREE.Vector3()
    .lerpVectors(p0, p1, ROUTE_PREVIEW_KICKOFF_FRAC)
    .setY(p0.y + ROUTE_PREVIEW_Y_LIFT);
  const rest = points
    .slice(1)
    .map((p) => new THREE.Vector3(p.x, p.y + ROUTE_PREVIEW_Y_LIFT, p.z));
  return [p0.clone(), kickoff, ...rest];
}

/**
 * "Take this route" reroute preview — a solid neutral-gray alternate path
 * branching from a delay shard, previewing what the projected line would
 * look like if the shard's catch-up plan were taken. Not committed until the
 * user clicks the button; purely a preview overlay alongside the real
 * projected tube. Google-Maps-alternate-route treatment: flat, low-opacity,
 * NOT dashed (dash is reserved for ghosted/superseded routes). Radius sits
 * close to the actual/projected tubes — visible from afar — but stays below
 * the taken-route radius so it never competes with the current path.
 */
export function createRoutePreviewLine(points: THREE.Vector3[]): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(
    liftRoutePreviewPoints(points),
    false,
    "catmullrom",
    0.4
  );
  const tubular = Math.max(48, Math.floor(curve.getLength() * 8));
  const geometry = new THREE.TubeGeometry(
    curve,
    tubular,
    TUBE_RADIUS_ROUTE_PREVIEW,
    TUBE_RADIAL,
    false
  );
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#8f887c"),
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "route-preview";
  mesh.userData.kind = "route-preview";
  return mesh;
}

/**
 * Ghost of a projected-path segment as it existed immediately before a
 * catch-up route was taken — "this used to be the plan, no longer current."
 * Muted grey, low opacity, dashed; kept permanently (never removed), one per
 * commit, so multiple taken routes each leave their own ghost behind.
 */
export function createGhostRouteLine(curve: THREE.CatmullRomCurve3): THREE.Line {
  const pts = curve.getPoints(80);
  const geometry = new THREE.BufferGeometry().setFromPoints(pts);
  const material = new THREE.LineDashedMaterial({
    color: new THREE.Color("#9a958c"),
    dashSize: 0.4,
    gapSize: 0.35,
    transparent: true,
    opacity: 0.2,
    linewidth: 1,
  });
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  line.name = "ghost-route";
  line.userData.kind = "ghost-route";
  line.position.y -= 0.012; // sit a hair below the live lines, avoid z-fighting
  return line;
}

/**
 * "Suggested route" pill label that rides along the reroute preview so the
 * dashed line reads as a suggestion even before the card is read — not
 * something already taken.
 */
export function createRoutePreviewLabel(text: string): THREE.Sprite {
  const w = 512;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.7, 1.7 * (h / w), 1);
  sprite.renderOrder = 10;
  sprite.name = "route-preview-label";
  if (!ctx) return sprite;

  const label = text.toUpperCase();
  ctx.font = "700 42px 'IBM Plex Sans', sans-serif";
  const textWidth = ctx.measureText(label).width;
  const boxW = Math.min(w - 8, textWidth + 96);
  const boxH = 84;
  const x0 = (w - boxW) / 2;
  const y0 = (h - boxH) / 2;
  const r = boxH / 2;

  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.arcTo(x0 + boxW, y0, x0 + boxW, y0 + boxH, r);
  ctx.arcTo(x0 + boxW, y0 + boxH, x0, y0 + boxH, r);
  ctx.arcTo(x0, y0 + boxH, x0, y0, r);
  ctx.arcTo(x0, y0, x0 + boxW, y0, r);
  ctx.closePath();
  ctx.fillStyle = "rgba(247, 243, 236, 0.96)";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#8f887c";
  ctx.stroke();

  ctx.fillStyle = "#4a463d";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, w / 2, h / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  mat.map = tex;
  mat.needsUpdate = true;
  return sprite;
}

export function updateRoutePreviewLine(
  mesh: THREE.Mesh,
  points: THREE.Vector3[]
): void {
  const curve = new THREE.CatmullRomCurve3(
    liftRoutePreviewPoints(points),
    false,
    "catmullrom",
    0.4
  );
  const tubular = Math.max(48, Math.floor(curve.getLength() * 8));
  mesh.geometry.dispose();
  mesh.geometry = new THREE.TubeGeometry(
    curve,
    tubular,
    TUBE_RADIUS_ROUTE_PREVIEW,
    TUBE_RADIAL,
    false
  );
}

/**
 * “Today” marker — deliberate engraved ink-stamp, not a plain slab:
 * a thin vertical needle + crossbar (no wide plate), a snug collar on the
 * path, and a layered floor stamp (soft ink wash + crisp ring + center dot).
 */
export function createTodayMarker(
  position: THREE.Vector3,
  tangent: THREE.Vector3
): THREE.Group {
  const group = new THREE.Group();
  group.name = "today-marker";
  group.position.copy(position);

  // Orient so local +Y is world up; faces across the path
  const forward = tangent.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  let side = new THREE.Vector3().crossVectors(up, forward);
  if (side.lengthSq() < 1e-5) side.set(0, 0, 1);
  side.normalize();
  const basis = new THREE.Matrix4().makeBasis(side, up, forward);
  group.quaternion.setFromRotationMatrix(basis);

  // Thin vertical needle (narrow in both plan dims — reads as a mark, not a box)
  const planeGeo = new THREE.BoxGeometry(0.02, 1.0, 0.02);
  const planeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#2b2824"),
    metalness: 0,
    roughness: 0.35,
    transparent: true,
    opacity: 0.9,
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.position.y = 0.5;
  group.add(plane);

  // Engraved crossbar near the top — like a surveyor's landmark finial
  const barGeo = new THREE.BoxGeometry(0.16, 0.05, 0.05);
  const barMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#8b9a6e"),
    metalness: 0,
    roughness: 0.4,
  });
  const bar = new THREE.Mesh(barGeo, barMat);
  bar.position.y = 0.98;
  group.add(bar);

  // Fine engraved collar on the path — torus calibrated to snugly ring the 0.085 tube.
  // Full-opacity ink for contrast against the cream floor (weight bumped for legibility).
  const ringGeo = new THREE.TorusGeometry(0.14, 0.022, 16, 64);
  const ringMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#2b2824"),
    metalness: 0,
    roughness: 0.35,
    transparent: true,
    opacity: 1,
  });
  const collar = new THREE.Mesh(ringGeo, ringMat);
  collar.rotation.x = Math.PI / 2;
  group.add(collar);

  // Precise engraved floor dot — a small mark, NOT a wide halo/stamp.
  // (A broad flat annulus read as an unexplained circular glow on the carpet.)
  const dotGeo = new THREE.CircleGeometry(0.045, 32);
  const dotMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#2b2824"),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = -0.02;
  group.add(dot);

  group.userData.kind = "today";
  group.userData.plane = plane;
  group.userData.planeMat = planeMat;
  group.userData.collar = collar;
  group.userData.collarMat = ringMat;
  group.userData.dot = dot;
  group.userData.dotMat = dotMat;
  return group;
}

/**
 * Predicted-risk marker on the projected line — hollow/wireframe amber, the
 * opposite treatment of the solid filled red crystal used for delays that
 * have already happened, so "predicted" reads distinctly from "occurred" at
 * a glance.
 */
export function createForecastShard(spec: {
  id: string;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
}): THREE.Group {
  const group = new THREE.Group();
  group.name = `forecast-${spec.id}`;
  group.position.copy(spec.position);

  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, spec.tangent);
  group.quaternion.copy(quat);

  const crystalGeo = new THREE.IcosahedronGeometry(0.24, 0);
  crystalGeo.scale(0.75, 1.35, 0.75);

  const crystalMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#c9843a"),
    wireframe: true,
    transparent: true,
    opacity: 0.95,
  });
  const crystal = new THREE.Mesh(crystalGeo, crystalMat);
  crystal.userData.kind = "forecast-shard";
  crystal.userData.forecastId = spec.id;
  group.add(crystal);

  // Wireframe-only geometry is thin and hard to click reliably — an
  // invisible solid twin gives raycasting a real hit target.
  const hit = new THREE.Mesh(
    crystalGeo.clone(),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hit.userData.kind = "forecast-shard";
  hit.userData.forecastId = spec.id;
  group.add(hit);

  const ringGeo = new THREE.RingGeometry(0.28, 0.33, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#c9843a"),
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.name = "forecast-ring";
  ring.visible = false;
  group.add(ring);

  group.userData.kind = "forecast-shard";
  group.userData.crystal = crystal;
  group.userData.crystalMat = crystalMat;
  group.userData.ring = ring;
  group.userData.ringMat = ringMat;
  return group;
}

/** A restrained bracket marker for a waypoint that contributes to projected finish. */
export function createCriticalPathMarker(spec: {
  id: string;
  position: THREE.Vector3;
  isCritical: boolean;
}): THREE.Group {
  const group = new THREE.Group();
  group.name = `critical-${spec.id}`;
  group.position.copy(spec.position);
  const color = spec.isCritical ? "#b34c2e" : "#9a958c";
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.34, 0.34, 0.04)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: spec.isCritical ? 0.92 : 0.3 })
  );
  frame.rotation.x = Math.PI / 4;
  group.add(frame);
  group.userData.kind = "critical-path";
  group.userData.frame = frame;
  return group;
}

/** Square checkpoint marker, intentionally distinct from the crystal shards. */
export function createMilestoneMarker(spec: {
  id: string;
  position: THREE.Vector3;
  state: "reached" | "upcoming";
}): THREE.Group {
  const group = new THREE.Group();
  group.name = `milestone-${spec.id}`;
  group.position.copy(spec.position);
  const color = spec.state === "reached" ? "#2f7f6f" : "#b27a34";
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.28, 0.28, 0.08)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 })
  );
  frame.rotation.y = Math.PI / 4;
  group.add(frame);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 })
  );
  stem.position.y = 0.22;
  group.add(stem);
  group.userData.kind = "milestone";
  group.userData.frame = frame;
  group.userData.state = spec.state;
  return group;
}

export function createProjectedEmphasisLine(
  points: THREE.Vector3[],
  isCritical: boolean
): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineDashedMaterial({
      color: isCritical ? "#2b2824" : "#b8aa98",
      dashSize: isCritical ? 0.28 : 0.18,
      gapSize: isCritical ? 0.18 : 0.24,
      transparent: true,
      opacity: isCritical ? 0.9 : 0.5,
      depthWrite: false,
    })
  );
  line.computeLineDistances();
  line.position.z += 0.055;
  line.name = isCritical ? "critical-projected-segment" : "slack-projected-segment";
  line.userData.kind = "projected-emphasis";
  return line;
}

export function updateProjectedEmphasisLine(
  line: THREE.Line,
  points: THREE.Vector3[],
  isCritical: boolean
): void {
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(points);
  line.computeLineDistances();
  const material = line.material as THREE.LineDashedMaterial;
  material.color.set(isCritical ? "#2b2824" : "#b8aa98");
  material.opacity = isCritical ? 0.9 : 0.5;
  line.name = isCritical ? "critical-projected-segment" : "slack-projected-segment";
}

function createCountBadgeTexture(count: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(247, 243, 236, 0.96)";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(161, 29, 34, 0.9)";
  ctx.stroke();
  ctx.fillStyle = "#2b2824";
  ctx.font = "bold 64px Syne, IBM Plex Sans, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(count), size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** One clickable marker per cluster (singleton or multi with count badge). */
export function createClusterShard(cluster: ShardCluster): THREE.Group {
  const group = new THREE.Group();
  group.name = `cluster-${cluster.id}`;
  group.position.copy(cluster.position);

  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, cluster.tangent);
  group.quaternion.copy(quat);

  const scaleBoost = cluster.items.length > 1 ? 1.15 : 1;
  const crystalGeo = new THREE.IcosahedronGeometry(0.24 * scaleBoost, 0);
  crystalGeo.scale(0.75, 1.35, 0.75);

  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#a11d22"),
    metalness: 0.12,
    roughness: 0.3,
    emissive: new THREE.Color("#000000"),
    emissiveIntensity: 0,
    flatShading: true,
    clearcoat: 0.5,
    clearcoatRoughness: 0.18,
  });
  const crystal = new THREE.Mesh(crystalGeo, crystalMat);
  crystal.userData.kind = "shard";
  crystal.userData.clusterId = cluster.id;
  group.add(crystal);

  const ringGeo = new THREE.RingGeometry(0.26, 0.32, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#a11d22"),
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.name = "attention-ring";
  ring.userData.kind = "shard-ring";
  group.add(ring);

  let badge: THREE.Sprite | null = null;
  if (cluster.items.length > 1) {
    const tex = createCountBadgeTexture(cluster.items.length);
    const badgeMat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    badge = new THREE.Sprite(badgeMat);
    badge.scale.set(0.65, 0.65, 0.65);
    badge.position.set(0.38, 0.52, 0);
    badge.userData.kind = "cluster-badge";
    badge.userData.clusterId = cluster.id;
    group.add(badge);
  }

  group.userData.kind = "shard-root";
  group.userData.clusterId = cluster.id;
  group.userData.crystal = crystal;
  group.userData.ring = ring;
  group.userData.badge = badge;
  group.userData.crystalMat = crystalMat;
  group.userData.ringMat = ringMat;
  group.userData.itemCount = cluster.items.length;
  // Visible immediately — actual-to-date path is not click-gated.
  group.visible = true;

  return group;
}

export { TUBE_RADIUS_ACTUAL, TUBE_RADIUS_PLANNED, TUBE_RADIUS_PROJECTED };
