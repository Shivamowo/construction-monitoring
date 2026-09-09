import * as THREE from "three";
import type { ShardCluster } from "./pathFromWaypoints";

const TUBE_RADIUS_ACTUAL = 0.085;
const TUBE_RADIUS_PLANNED = 0.055;
const TUBE_RADIUS_PROJECTED = 0.07;
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
  /* Glassy navy planned path — clearcoat for specular on the light backdrop */
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#3a5b7e"),
    metalness: 0.18,
    roughness: 0.24,
    clearcoat: 0.55,
    clearcoatRoughness: 0.16,
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

  /* Light theme: saturated terracotta, glassy translucency, shadow depth */
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#bf5b3f"),
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

/** Dashed centerline overlay so the forecast reads as provisional. */
export function createProjectedDashLine(
  curve: THREE.CatmullRomCurve3
): THREE.Line {
  const pts = curve.getPoints(80);
  /* Light theme: muted terracotta dash */
  const geometry = new THREE.BufferGeometry().setFromPoints(pts);
  const material = new THREE.LineDashedMaterial({
    color: new THREE.Color("#bf5b3f"),
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
