import type { DelaySeverity, NavigatorWaypoint } from "@/lib/schedule-navigator/aggregate";
import { severityColor } from "./colors";

export interface PointRef {
  x: number;
  y: number;
  w: NavigatorWaypoint;
}

export interface DelayCluster {
  id: string;
  x: number;
  y: number;
  items: PointRef[];
  /** Max local delay in cluster (for color). */
  severity: DelaySeverity;
  color: string;
}

export interface PlacedLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  anchor: "middle" | "start" | "end";
  /** Hidden labels still available via hover on nearby marker. */
  hidden: boolean;
}

const approxTextWidth = (text: string, fontSize: number) =>
  Math.max(text.length * fontSize * 0.62, fontSize * 2);

/**
 * Greedy 1D clustering: merge points within `radiusPx` on X.
 */
export function clusterPoints(
  points: PointRef[],
  radiusPx: number
): DelayCluster[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const clusters: DelayCluster[] = [];

  for (const p of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(p.x - last.x) <= radiusPx) {
      last.items.push(p);
      const xs = last.items.reduce((s, it) => s + it.x, 0);
      last.x = xs / last.items.length;
      // Prefer worst severity in cluster
      const sevRank = { none: 0, mild: 1, severe: 2 } as const;
      for (const it of last.items) {
        if (sevRank[it.w.severity] > sevRank[last.severity]) {
          last.severity = it.w.severity;
          last.color = severityColor(it.w.severity);
        }
      }
      last.id = `c-${last.items.map((i) => i.w.id).join("|").slice(0, 48)}`;
    } else {
      clusters.push({
        id: `c-${p.w.id}`,
        x: p.x,
        y: p.y,
        items: [p],
        severity: p.w.severity,
        color: severityColor(p.w.severity),
      });
    }
  }
  return clusters;
}

/**
 * Place labels without horizontal overlap. Prefer merge of identical text when
 * close; otherwise stagger above/below; drop lowest-priority when still tight.
 */
export function placeCollisionAwareLabels(
  candidates: {
    id: string;
    x: number;
    text: string;
    priority: number;
    baseY: number;
  }[],
  opts: { fontSize: number; minGap: number; stagger: number }
): PlacedLabel[] {
  const sorted = [...candidates].sort((a, b) => a.x - b.x);
  const placed: PlacedLabel[] = [];
  const occupied: { x0: number; x1: number; y: number }[] = [];

  const collides = (x0: number, x1: number, y: number) =>
    occupied.some(
      (o) => Math.abs(o.y - y) < opts.fontSize * 0.9 && !(x1 < o.x0 || x0 > o.x1)
    );

  for (const c of sorted) {
    const w = approxTextWidth(c.text, opts.fontSize);
    const x0 = c.x - w / 2;
    const x1 = c.x + w / 2;

    // Merge with previous if same text and overlapping X
    const prev = placed[placed.length - 1];
    if (
      prev &&
      !prev.hidden &&
      prev.text === c.text &&
      Math.abs(prev.x - c.x) < opts.minGap
    ) {
      // Keep previous; skip duplicate
      continue;
    }

    const candidatesY = [
      c.baseY,
      c.baseY - opts.stagger,
      c.baseY + opts.stagger,
      c.baseY - opts.stagger * 2,
    ];

    let chosenY: number | null = null;
    for (const y of candidatesY) {
      if (!collides(x0, x1, y)) {
        chosenY = y;
        break;
      }
    }

    if (chosenY == null) {
      placed.push({
        id: c.id,
        text: c.text,
        x: c.x,
        y: c.baseY,
        anchor: "middle",
        hidden: true,
      });
      continue;
    }

    occupied.push({ x0: x0 - 4, x1: x1 + 4, y: chosenY });
    placed.push({
      id: c.id,
      text: c.text,
      x: c.x,
      y: chosenY,
      anchor: "middle",
      hidden: false,
    });
  }

  return placed;
}

/** Pixel radius for clustering scales gently with zoom (tighter when zoomed in). */
export function clusterRadiusForZoom(k: number): number {
  // k=1 → 36px; k=4 → ~18px; k=16 → ~12px floor
  return Math.max(12, 36 / Math.sqrt(Math.max(k, 1)));
}

export function labelMinGapForZoom(k: number): number {
  return Math.max(48, 88 / Math.sqrt(Math.max(k, 1)));
}
