import * as THREE from "three";

export type AxisLabelKind =
  | "month"
  | "start"
  | "plannedEnd"
  | "today"
  | "projectedEnd";

export interface TimelineScale {
  /** Inclusive calendar start (ms UTC midnight). */
  startMs: number;
  /** Inclusive calendar end (ms) — max(planned end, projected end). */
  endMs: number;
  spanMs: number;
  xSpan: number;
  /** Axis baseline world Y / Z. */
  axisY: number;
  axisZ: number;
}

export interface AxisAnchor {
  id: string;
  kind: AxisLabelKind;
  iso: string;
  label: string;
  sublabel?: string;
  world: THREE.Vector3;
}

export interface TimelineInputs {
  start: string;
  plannedEnd: string;
  projectedEnd: string;
  /** Calendar date for the today marker (from timeline.asOf). */
  todayIso: string;
  xSpan: number;
}

function parseTime(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

function formatMonth(isoOrMs: string | number): string {
  const d =
    typeof isoOrMs === "number"
      ? new Date(isoOrMs)
      : new Date(`${isoOrMs}T00:00:00Z`);
  return d.toLocaleString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function buildTimelineScale(input: TimelineInputs): TimelineScale {
  const startMs = parseTime(input.start);
  const endMs = Math.max(
    parseTime(input.plannedEnd),
    parseTime(input.projectedEnd)
  );
  const spanMs = Math.max(endMs - startMs, 1);
  return {
    startMs,
    endMs,
    spanMs,
    xSpan: input.xSpan,
    axisY: -0.38,
    axisZ: -5.6,
  };
}

export function dateToX(iso: string, scale: TimelineScale): number {
  const t = parseTime(iso);
  return ((t - scale.startMs) / scale.spanMs) * scale.xSpan;
}

export function msToX(ms: number, scale: TimelineScale): number {
  return ((ms - scale.startMs) / scale.spanMs) * scale.xSpan;
}

/** First of each month between start and end (inclusive window). */
export function monthlyTickMs(scale: TimelineScale): number[] {
  const ticks: number[] = [];
  const start = new Date(scale.startMs);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  // Start at first of month on or after calendar start
  let cursor = Date.UTC(y, m, 1);
  if (cursor < scale.startMs) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    cursor = Date.UTC(y, m, 1);
  }
  while (cursor <= scale.endMs) {
    ticks.push(cursor);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    cursor = Date.UTC(y, m, 1);
  }
  return ticks;
}

export function buildAxisAnchors(
  input: TimelineInputs,
  scale: TimelineScale
): AxisAnchor[] {
  const anchors: AxisAnchor[] = [];
  const yMonth = scale.axisY - 0.15;
  const yKey = scale.axisY + 0.85;
  const z = scale.axisZ;

  const keyMs = [
    parseTime(input.start),
    parseTime(input.plannedEnd),
    parseTime(input.todayIso),
    parseTime(input.projectedEnd),
  ];
  const day = 86_400_000;

  for (const ms of monthlyTickMs(scale)) {
    // Skip month labels that would collide with a key event label
    if (keyMs.some((k) => Math.abs(ms - k) < 14 * day)) continue;
    const iso = new Date(ms).toISOString().slice(0, 10);
    anchors.push({
      id: `m-${iso}`,
      kind: "month",
      iso,
      label: formatMonth(ms),
      world: new THREE.Vector3(msToX(ms, scale), yMonth, z),
    });
  }

  const key = (
    id: string,
    kind: AxisLabelKind,
    iso: string,
    label: string,
    sublabel?: string
  ): AxisAnchor => ({
    id,
    kind,
    iso,
    label,
    sublabel,
    world: new THREE.Vector3(dateToX(iso, scale), yKey, z),
  });

  anchors.push(key("start", "start", input.start, "Start", formatDay(input.start)));
  anchors.push(
    key("plannedEnd", "plannedEnd", input.plannedEnd, "Planned end", formatDay(input.plannedEnd))
  );
  anchors.push(
    key("today", "today", input.todayIso, "Today", formatDay(input.todayIso))
  );

  if (input.projectedEnd !== input.plannedEnd) {
    anchors.push(
      key(
        "projectedEnd",
        "projectedEnd",
        input.projectedEnd,
        "Projected end",
        formatDay(input.projectedEnd)
      )
    );
  }

  return anchors;
}

/** Thin rail + tick marks along the calendar X axis (WebGL geometry only).
 *  Deliberate guide — warm dark ink, real thickness so it reads against cream. */
export function createAxisRail(
  scale: TimelineScale,
  monthMs: number[]
): THREE.Group {
  const group = new THREE.Group();
  group.name = "timeline-axis";

  const railMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#3d3732"),
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const railGeo = new THREE.BoxGeometry(scale.xSpan, 0.02, 0.02);
  const rail = new THREE.Mesh(railGeo, railMat);
  rail.position.set(scale.xSpan / 2, scale.axisY, scale.axisZ);
  group.add(rail);

  const tickMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#5a5249"),
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  for (const ms of monthMs) {
    const x = msToX(ms, scale);
    const tickGeo = new THREE.BoxGeometry(0.02, 0.34, 0.02);
    const tick = new THREE.Mesh(tickGeo, tickMat);
    tick.position.set(x, scale.axisY + 0.17, scale.axisZ);
    group.add(tick);
  }

  // Stronger ticks for key events are drawn as short emissive posts in createKeyTick
  return group;
}

/** Quiet vertical hairline from axis up toward the path — shared today language. */
export function createKeyTick(
  x: number,
  scale: TimelineScale,
  colorHex: string,
  height = 1.1
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.03, height, 0.03);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, scale.axisY + height * 0.5, scale.axisZ);
  return mesh;
}

export interface ScreenLabel {
  el: HTMLElement;
  /** Position in navigator-root local space (same as path / axis ticks). */
  local: THREE.Vector3;
  world: THREE.Vector3;
  lastX: number;
  lastY: number;
}

/**
 * Project world → overlay pixels. Rounds to integers and skips no-op writes
 * so labels stay crisp during idle drift / orbit (no subpixel jitter).
 * Call after updating `world` from parent matrixWorld when labels live under a Group.
 */
export function syncProjectedLabels(
  labels: ScreenLabel[],
  camera: THREE.Camera,
  width: number,
  height: number
): void {
  const ndc = new THREE.Vector3();
  // Rows of already-claimed pixel spans (key labels only) → vertical stacking
  // so Projected End / Planned End never render on top of each other.
  const rows: number[][][] = [];

  for (const item of labels) {
    ndc.copy(item.world).project(camera);
    const behind = ndc.z > 1;
    const x = Math.round((ndc.x * 0.5 + 0.5) * width);
    const y = Math.round((-ndc.y * 0.5 + 0.5) * height);
    const onScreen =
      !behind && x >= -80 && x <= width + 80 && y >= -40 && y <= height + 40;

    if (!onScreen) {
      if (item.el.style.visibility !== "hidden") {
        item.el.style.visibility = "hidden";
      }
      continue;
    }

    if (item.el.style.visibility !== "visible") {
      item.el.style.visibility = "visible";
    }

    const isMonth = item.el.dataset.kind === "month";
    let anchor: string;
    if (isMonth) {
      anchor = "translate(-50%, 0%)";
    } else {
      const lw = item.el.offsetWidth || 0;
      const rh = item.el.offsetHeight || 40;
      const stride = rh + 8;
      const x0 = x - lw / 2;
      const x1 = x + lw / 2;
      let r = 0;
      for (;;) {
        const row = rows[r];
        if (!row) {
          rows[r] = [[x0, x1]];
          break;
        }
        const clash = row.some(([a, b]) => x0 < b && a < x1);
        if (!clash) {
          row.push([x0, x1]);
          break;
        }
        r += 1;
      }
      anchor = `translate(-50%, -100%) translateY(-${r * stride}px)`;
    }

    const transform = `translate3d(${x}px, ${y}px, 0) ${anchor}`;
    if (transform !== item.el.style.transform) {
      item.lastX = x;
      item.lastY = y;
      item.el.style.transform = transform;
    }
  }
}

/** Apply parent matrix so labels track scaled/animated navigator-root. */
export function updateLabelWorldFromRoot(
  labels: ScreenLabel[],
  root: THREE.Object3D
): void {
  root.updateMatrixWorld(true);
  for (const item of labels) {
    item.world.copy(item.local).applyMatrix4(root.matrixWorld);
  }
}

export function mountAxisLabelElements(
  container: HTMLElement,
  anchors: AxisAnchor[],
  classNames: {
    month: string;
    key: string;
    today: string;
    title: string;
    sub: string;
  },
  onLabelActivate?: (iso: string, kind: AxisLabelKind) => void
): ScreenLabel[] {
  container.replaceChildren();
  const labels: ScreenLabel[] = [];

  for (const a of anchors) {
    const el = document.createElement("button");
    el.type = "button";
    el.className =
      a.kind === "month"
        ? classNames.month
        : a.kind === "today"
          ? `${classNames.key} ${classNames.today}`
          : classNames.key;
    el.dataset.kind = a.kind;
    el.dataset.iso = a.iso;
    el.setAttribute("aria-label", `Scrub to ${a.label}${a.sublabel ? `, ${a.sublabel}` : ""}`);

    const title = document.createElement("span");
    title.className = classNames.title;
    title.textContent = a.label;
    el.appendChild(title);

    if (a.sublabel && a.kind !== "month") {
      const sub = document.createElement("span");
      sub.className = classNames.sub;
      sub.textContent = a.sublabel;
      el.appendChild(sub);
    }

    if (onLabelActivate) {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onLabelActivate(a.iso, a.kind);
      });
    }

    el.style.visibility = "hidden";
    container.appendChild(el);
    labels.push({
      el,
      local: a.world.clone(),
      world: a.world.clone(),
      lastX: -9999,
      lastY: -9999,
    });
  }

  return labels;
}

/** DOM playhead handle projected onto the timeline axis. */
export function createPlayheadElement(
  container: HTMLElement,
  className: string
): ScreenLabel {
  const el = document.createElement("div");
  el.className = className;
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", "Timeline playhead");
  el.tabIndex = 0;
  const knob = document.createElement("span");
  knob.dataset.part = "knob";
  el.appendChild(knob);
  const dateEl = document.createElement("span");
  dateEl.dataset.part = "date";
  el.appendChild(dateEl);
  el.style.visibility = "hidden";
  container.appendChild(el);
  return {
    el,
    local: new THREE.Vector3(),
    world: new THREE.Vector3(),
    lastX: -9999,
    lastY: -9999,
  };
}

export function syncPlayheadLabel(
  playhead: ScreenLabel,
  camera: THREE.Camera,
  width: number,
  height: number,
  dateText: string
): { x: number; y: number; onScreen: boolean } {
  const dateEl = playhead.el.querySelector("[data-part='date']");
  if (dateEl && dateEl.textContent !== dateText) {
    dateEl.textContent = dateText;
  }
  const ndc = playhead.world.clone().project(camera);
  const behind = ndc.z > 1;
  const x = Math.round((ndc.x * 0.5 + 0.5) * width);
  const y = Math.round((-ndc.y * 0.5 + 0.5) * height);
  const onScreen =
    !behind && x >= -40 && x <= width + 40 && y >= -40 && y <= height + 40;
  if (!onScreen) {
    playhead.el.style.visibility = "hidden";
    return { x, y, onScreen: false };
  }
  playhead.el.style.visibility = "visible";
  if (x !== playhead.lastX || y !== playhead.lastY) {
    playhead.lastX = x;
    playhead.lastY = y;
    playhead.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
  }
  return { x, y, onScreen: true };
}
