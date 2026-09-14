import * as THREE from "three";

export type AxisLabelKind =
  | "month"
  | "start"
  | "plannedEnd"
  | "today"
  | "projectedEnd"
  | "route";

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

/** World Y at 0% cumulative complete. */
export const PCT_AXIS_Y_BASE = 0.15;
/** World Y span from 0% to 100% cumulative complete. */
export const PCT_AXIS_Y_SPAN = 9.0;
/**
 * World X of the vertical % axis. Anchored to exactly the same X as the
 * "START" date marker (dateToX(timeline.start) === 0 by construction) so the
 * two visually align instead of floating apart. Previously hardcoded to 10,
 * which put the rail near "Apr 15" — disconnected from the actual start.
 */
export const PCT_AXIS_X = 0;

/** Cumulative % complete (0-100) → world Y, driving planned/actual/projected height. */
export function pctToY(pct: number): number {
  const clamped = Math.min(100, Math.max(0, pct));
  return PCT_AXIS_Y_BASE + (clamped / 100) * PCT_AXIS_Y_SPAN;
}

export interface PctAxisAnchor {
  id: string;
  pct: number;
  label: string;
  world: THREE.Vector3;
}

const PCT_TICKS = [0, 25, 50, 75, 100];

export function buildPctAxisAnchors(scale: TimelineScale): PctAxisAnchor[] {
  return PCT_TICKS.map((pct) => ({
    id: `pct-${pct}`,
    pct,
    label: `${pct}%`,
    world: new THREE.Vector3(PCT_AXIS_X, pctToY(pct), scale.axisZ),
  }));
}

/** Vertical % rail + tick marks — same warm ink language as createAxisRail. */
export function createPctAxisRail(scale: TimelineScale): THREE.Group {
  const group = new THREE.Group();
  group.name = "pct-axis";

  const railMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#3d3732"),
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const railHeight = PCT_AXIS_Y_SPAN;
  const railGeo = new THREE.BoxGeometry(0.02, railHeight, 0.02);
  const rail = new THREE.Mesh(railGeo, railMat);
  rail.position.set(PCT_AXIS_X, PCT_AXIS_Y_BASE + railHeight / 2, scale.axisZ);
  group.add(rail);

  const tickMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#5a5249"),
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  for (const pct of PCT_TICKS) {
    const tickGeo = new THREE.BoxGeometry(0.34, 0.02, 0.02);
    const tick = new THREE.Mesh(tickGeo, tickMat);
    tick.position.set(PCT_AXIS_X + 0.17, pctToY(pct), scale.axisZ);
    group.add(tick);
  }

  return group;
}

/** Mount static (non-interactive) % pill labels beside the vertical rail. */
export function mountPctLabelElements(
  container: HTMLElement,
  anchors: PctAxisAnchor[],
  className: string
): ScreenLabel[] {
  const labels: ScreenLabel[] = [];
  for (const a of anchors) {
    const el = document.createElement("span");
    el.className = className;
    el.dataset.kind = "pct";
    el.style.visibility = "hidden";
    el.style.pointerEvents = "none";

    const dot = document.createElement("span");
    dot.dataset.part = "dot";
    el.appendChild(dot);

    const leader = document.createElement("span");
    leader.dataset.part = "leader";
    el.appendChild(leader);

    const textWrap = document.createElement("span");
    textWrap.dataset.part = "text";
    textWrap.textContent = a.label;
    el.appendChild(textWrap);

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

/** Project % labels to screen, anchored to the left of their tick. */
export function syncPctLabels(
  labels: ScreenLabel[],
  camera: THREE.Camera,
  width: number,
  height: number
): void {
  const ndc = new THREE.Vector3();
  for (const item of labels) {
    ndc.copy(item.world).project(camera);
    const behind = ndc.z > 1;
    const x = Math.round((ndc.x * 0.5 + 0.5) * width);
    const y = Math.round((-ndc.y * 0.5 + 0.5) * height);
    const onScreen =
      !behind && x >= -120 && x <= width + 40 && y >= -40 && y <= height + 40;

    if (!onScreen) {
      if (item.el.style.visibility !== "hidden") {
        item.el.style.visibility = "hidden";
      }
      continue;
    }
    if (item.el.style.visibility !== "visible") {
      item.el.style.visibility = "visible";
    }
    const transform = `translate3d(${x}px, ${y}px, 0) translate(-100%, -50%) translateX(-10px)`;
    if (transform !== item.el.style.transform) {
      item.lastX = x;
      item.lastY = y;
      item.el.style.transform = transform;
    }
  }
}

/**
 * Unified collision-avoidance pass across EVERY DOM-projected label kind —
 * month ticks, key ticks (start/plannedEnd/today/projectedEnd), and the
 * vertical % axis pills. Previously key labels had their own row-stacking
 * system and % labels had none at all, so e.g. "START" and "0%" (same world
 * X after the % axis was anchored to match START) could land in the exact
 * same screen box. This does one real bounding-box overlap test across all
 * of them and nudges collisions along each label's own natural push-away
 * axis: key labels push further up, % labels push further left, month
 * labels push further down — so priority order (key, then %, then month)
 * keeps the most load-bearing labels closest to their true anchor point.
 */
export function syncAllProjectedLabels(
  labels: ScreenLabel[],
  camera: THREE.Camera,
  width: number,
  height: number
): void {
  const ndc = new THREE.Vector3();
  const priority = (kind: string | undefined): number => {
    if (kind === "route") return 1;
    if (kind === "pct") return 2;
    if (kind === "month") return 3;
    return 0; // start / plannedEnd / today / projectedEnd
  };

  const projected = labels.map((item) => {
    ndc.copy(item.world).project(camera);
    const behind = ndc.z > 1;
    const x = Math.round((ndc.x * 0.5 + 0.5) * width);
    const y = Math.round((-ndc.y * 0.5 + 0.5) * height);
    const onScreen =
      !behind && x >= -120 && x <= width + 120 && y >= -40 && y <= height + 40;
    return { item, x, y, onScreen };
  });

  const order = [...projected].sort(
    (a, b) => priority(a.item.el.dataset.kind) - priority(b.item.el.dataset.kind)
  );

  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];

  for (const p of order) {
    const { item, x, y, onScreen } = p;
    if (!onScreen) {
      if (item.el.style.visibility !== "hidden") item.el.style.visibility = "hidden";
      continue;
    }
    if (item.el.style.visibility !== "visible") item.el.style.visibility = "visible";

    const kind = item.el.dataset.kind;
    const isPct = kind === "pct";
    const isMonth = kind === "month";
    // Children are position:absolute now (leader-line layout), so the
    // outer el itself has no intrinsic box — measure the text part instead.
    const textEl = item.el.querySelector<HTMLElement>('[data-part="text"]');
    const lw = textEl?.offsetWidth || 40;
    const rh = textEl?.offsetHeight || 28;
    const stride = (isPct ? lw : rh) + 8;
    // The rendered text plate has its own CSS gap/padding/box-shadow the
    // model below doesn't fully capture — pad the estimated box outward so
    // a razor-thin real overlap (like Projected End vs an Alternate route
    // label landing a few px apart) can never slip through undetected.
    const SAFETY = 5;
    // Matches the CSS "+3px"/"+4px"/"+5px" gap between leader and text per kind.
    const textGap = isPct ? 5 : isMonth ? 3 : 3;

    // Base gap keeps text clear of its own anchor dot before any collision
    // shift is added — the leader line's length is baseGap + shift, so a
    // label pushed into a lower/higher row visibly grows a longer leader
    // rather than silently jumping away from its real anchor.
    const baseGap = isPct ? 10 : isMonth ? 8 : 12;
    let shift = 0;
    let x0 = 0;
    let y0 = 0;
    let x1 = 0;
    let y1 = 0;
    for (;;) {
      const leaderLen = baseGap + shift + textGap;
      if (isPct) {
        x1 = x - leaderLen;
        x0 = x1 - lw;
        y0 = y - rh / 2;
        y1 = y + rh / 2;
      } else if (isMonth) {
        x0 = x - lw / 2;
        x1 = x + lw / 2;
        y0 = y + leaderLen;
        y1 = y0 + rh;
      } else {
        x0 = x - lw / 2;
        x1 = x + lw / 2;
        y1 = y - leaderLen;
        y0 = y1 - rh;
      }
      const clash = placed.some(
        (b) =>
          x0 - SAFETY < b.x1 &&
          x1 + SAFETY > b.x0 &&
          y0 - SAFETY < b.y1 &&
          y1 + SAFETY > b.y0
      );
      if (!clash) {
        placed.push({ x0, y0, x1, y1 });
        break;
      }
      shift += stride;
    }

    item.el.style.setProperty("--leader-len", `${baseGap + shift}px`);
    const transform = `translate3d(${x}px, ${y}px, 0)`;
    if (transform !== item.el.style.transform) {
      item.lastX = x;
      item.lastY = y;
      item.el.style.transform = transform;
    }
  }
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
    // "today" sits extra-high: the today-marker ink-stamp (needle + crossbar,
    // ~1 world unit tall) lives ON the path itself, not at the rail, so the
    // uniform yKey height used by the other key labels can land right on top
    // of it depending on progress % / camera angle.
    world: new THREE.Vector3(
      dateToX(iso, scale),
      kind === "today" ? yKey + 0.35 : yKey,
      z
    ),
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

    // Deliberate annotation, not a UI button: a small dot at the exact
    // anchor, a thin leader line, and the text riding at the end of it —
    // instead of a uniform pill floating disconnected from its subject.
    const dot = document.createElement("span");
    dot.dataset.part = "dot";
    el.appendChild(dot);

    const leader = document.createElement("span");
    leader.dataset.part = "leader";
    el.appendChild(leader);

    const textWrap = document.createElement("span");
    textWrap.dataset.part = "text";
    el.appendChild(textWrap);

    const title = document.createElement("span");
    title.className = classNames.title;
    title.textContent = a.label;
    textWrap.appendChild(title);

    if (a.sublabel && a.kind !== "month") {
      const sub = document.createElement("span");
      sub.className = classNames.sub;
      sub.textContent = a.sublabel;
      textWrap.appendChild(sub);
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

/**
 * A single non-interactive DOM label (dot + leader + text) for a 3D-world
 * anchor that isn't on the calendar axis — e.g. an alternate-route line's
 * "Alternate route" tag. Uses the exact same DOM shape as axis labels so it
 * runs through the same syncAllProjectedLabels collision pass instead of
 * being a WebGL sprite nothing else can see.
 */
export function mountRouteLabelElement(
  container: HTMLElement,
  id: string,
  text: string,
  world: THREE.Vector3,
  classNames: { key: string; title: string }
): ScreenLabel {
  const el = document.createElement("div");
  el.className = classNames.key;
  el.dataset.kind = "route";
  el.dataset.id = id;

  const dot = document.createElement("span");
  dot.dataset.part = "dot";
  el.appendChild(dot);

  const leader = document.createElement("span");
  leader.dataset.part = "leader";
  el.appendChild(leader);

  const textWrap = document.createElement("span");
  textWrap.dataset.part = "text";
  el.appendChild(textWrap);

  const title = document.createElement("span");
  title.className = classNames.title;
  title.textContent = text;
  textWrap.appendChild(title);

  el.style.visibility = "hidden";
  container.appendChild(el);
  return {
    el,
    local: world.clone(),
    world: world.clone(),
    lastX: -9999,
    lastY: -9999,
  };
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
