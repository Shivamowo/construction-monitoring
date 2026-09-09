"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom as d3Zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { curveCatmullRom, line as d3Line } from "d3-shape";
import { scaleTime } from "d3-scale";
import type {
  DelaySeverity,
  NavigatorWaypoint,
  ScheduleNavigatorPayload,
} from "@/lib/schedule-navigator/aggregate";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { severityColor, severityLabel } from "./colors";
import {
  clusterPoints,
  clusterRadiusForZoom,
  labelMinGapForZoom,
  placeCollisionAwareLabels,
  type DelayCluster,
  type PointRef,
} from "./layout";
import { useRouteAnimation } from "./useRouteAnimation";
import styles from "./ScheduleNavigator.module.css";

const WIDTH = 1200;
const HEIGHT = 560;
const MARGIN = { top: 64, right: 48, bottom: 80, left: 72 };
const PLANNED_Y = 190;
const PROJECTED_Y = 350;
const INNER_LEFT = MARGIN.left;
const INNER_RIGHT = WIDTH - MARGIN.right;

type HoverState =
  | { kind: "delay"; waypoint: NavigatorWaypoint; x: number; y: number }
  | { kind: "cluster"; cluster: DelayCluster; x: number; y: number }
  | { kind: "label"; text: string; x: number; y: number }
  | null;

function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function formatTick(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function buildSmoothPath(points: { x: number; y: number }[]): string {
  const generator = d3Line<{ x: number; y: number }>()
    .x((d) => d.x)
    .y((d) => d.y)
    .curve(curveCatmullRom.alpha(0.55));
  return generator(points) ?? "";
}

function segmentPath(
  a: { x: number; y: number },
  b: { x: number; y: number }
): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + Math.sign(b.x - a.x) * Math.min(18, Math.abs(b.x - a.x) * 0.035);
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
}

function severityRank(s: DelaySeverity): number {
  return s === "severe" ? 2 : s === "mild" ? 1 : 0;
}

export function ScheduleNavigator() {
  const [data, setData] = useState<ScheduleNavigatorPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [animReady, setAnimReady] = useState(false);
  const [routesDrawn, setRoutesDrawn] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/schedule-navigator");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as ScheduleNavigatorPayload;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fullDomain = useMemo(() => {
    if (!data) return null;
    const endIso =
      data.timeline.projectedEnd > data.timeline.end
        ? data.timeline.projectedEnd
        : data.timeline.end;
    return [parseDate(data.timeline.start), parseDate(endIso)] as [Date, Date];
  }, [data]);

  const baseX = useMemo(() => {
    if (!fullDomain) return null;
    return scaleTime().domain(fullDomain).range([INNER_LEFT, INNER_RIGHT]);
  }, [fullDomain]);

  // Attach d3-zoom once data is ready
  useEffect(() => {
    if (!svgRef.current || !baseX || !fullDomain) return;

    const svg = select(svgRef.current);
    const zoom = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 28])
      .extent([
        [INNER_LEFT, 0],
        [INNER_RIGHT, HEIGHT],
      ])
      .translateExtent([
        [INNER_LEFT, -Infinity],
        [INNER_RIGHT, Infinity],
      ])
      .filter((event) => {
        // Allow wheel zoom; drag pan on background; ignore interactive markers
        if (event.type === "wheel") return true;
        const t = event.target as Element | null;
        if (t?.closest?.("[data-interactive='true']")) return false;
        return !event.ctrlKey;
      })
      .on("zoom", (event) => {
        setTransform(event.transform);
        setHover(null);
      });

    zoomRef.current = zoom;
    svg.call(zoom);
    // Reset to identity when domain loads
    svg.call(zoom.transform, zoomIdentity);
    setTransform(zoomIdentity);
    setAnimReady(true);

    return () => {
      svg.on(".zoom", null);
      zoomRef.current = null;
    };
  }, [baseX, fullDomain]);

  const x = useMemo(() => {
    if (!baseX) return null;
    return transform.rescaleX(baseX);
  }, [baseX, transform]);

  const geometry = useMemo(() => {
    if (!data || !x) return null;

    const plannedPts: PointRef[] = data.waypoints.map((w) => ({
      x: x(parseDate(w.plannedEnd)),
      y: PLANNED_Y,
      w,
    }));
    const projectedPts: PointRef[] = data.waypoints.map((w) => ({
      x: x(parseDate(w.projectedEnd)),
      y: PROJECTED_Y,
      w,
    }));

    // Clip-aware: still draw full path so pan feels continuous
    const plannedPath = buildSmoothPath(plannedPts);
    const projectedSegments = projectedPts.slice(1).map((pt, i) => {
      const prev = projectedPts[i];
      return {
        d: segmentPath(prev, pt),
        severity: pt.w.severity as DelaySeverity,
        color: severityColor(pt.w.severity),
        id: pt.w.id,
      };
    });

    const ticks = x.ticks(Math.min(10, Math.max(4, Math.round(6 * transform.k))));
    const delayPts = projectedPts.filter((p) => p.w.localDelayDays > 0);
    const radius = clusterRadiusForZoom(transform.k);
    const clusters = clusterPoints(delayPts, radius);

    const milestoneCandidates = plannedPts.map((p, i) => ({
      id: `m-${p.w.id}`,
      x: p.x,
      text: p.w.milestoneClass.toUpperCase(),
      priority: p.w.componentCount + (i === 0 || i === plannedPts.length - 1 ? 1000 : 0),
      baseY: PLANNED_Y - 28,
    }));

    const milestoneLabels = placeCollisionAwareLabels(milestoneCandidates, {
      fontSize: 12,
      minGap: labelMinGapForZoom(transform.k),
      stagger: 16,
    });

    // Delay annotations only for singleton clusters that are visible enough
    const delayLabelCandidates = clusters
      .filter((c) => c.items.length === 1)
      .map((c) => ({
        id: `dlab-${c.items[0].w.id}`,
        x: c.x,
        text: `+${c.items[0].w.localDelayDays}d`,
        priority: c.items[0].w.localDelayDays * 10 + c.items[0].w.componentCount,
        baseY: PROJECTED_Y - 22,
      }));

    const delayLabels = placeCollisionAwareLabels(delayLabelCandidates, {
      fontSize: 12,
      minGap: labelMinGapForZoom(transform.k) * 0.75,
      stagger: 18,
    });

    return {
      plannedPath,
      plannedPts,
      projectedPts,
      projectedSegments,
      ticks,
      clusters,
      milestoneLabels,
      delayLabels,
      zoomK: transform.k,
      clusterRadius: radius,
    };
  }, [data, x, transform.k]);

  const rootRef = useRouteAnimation({
    ready: Boolean(data && geometry && animReady),
    plannedSelector: "[data-anim='planned']",
    projectedSelector: "[data-anim='projected']",
    markerSelector: "[data-anim='marker']",
    axisSelector: "[data-anim='axis']",
    onComplete: () => setRoutesDrawn(true),
  });

  const zoomToDates = (start: Date, end: Date) => {
    if (!svgRef.current || !baseX || !zoomRef.current) return;
    const padMs = Math.max(2 * 86400000, (end.getTime() - start.getTime()) * 0.25);
    const d0 = new Date(start.getTime() - padMs);
    const d1 = new Date(end.getTime() + padMs);
    const full = baseX.domain() as [Date, Date];
    const x0 = baseX(full[0]);
    const x1 = baseX(full[1]);
    const fullW = x1 - x0;
    const viewW = INNER_RIGHT - INNER_LEFT;
    const targetW = Math.max(baseX(d1) - baseX(d0), 1);
    const k = Math.min(28, Math.max(1, (viewW / targetW) * 0.92));
    const mid = (baseX(d0) + baseX(d1)) / 2;
    const tx = viewW / 2 + INNER_LEFT - mid * k;
    // Clamp translate so we don't leave the domain
    const maxTx = INNER_LEFT - x0 * k;
    const minTx = INNER_RIGHT - x1 * k;
    const clampedTx = Math.min(maxTx, Math.max(minTx, tx));
    const next = zoomIdentity.translate(clampedTx, 0).scale(k);
    select(svgRef.current)
      .transition()
      .duration(650)
      .call(zoomRef.current.transform, next);
    void fullW;
  };

  const zoomBy = (factor: number) => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).transition().duration(280).call(zoomRef.current.scaleBy, factor);
  };

  const resetZoom = () => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current)
      .transition()
      .duration(400)
      .call(zoomRef.current.transform, zoomIdentity);
  };

  const onClusterActivate = (cluster: DelayCluster) => {
    if (cluster.items.length === 1) {
      setHover({
        kind: "delay",
        waypoint: cluster.items[0].w,
        x: cluster.x,
        y: cluster.y,
      });
      return;
    }
    const dates = cluster.items.map((it) => parseDate(it.w.projectedEnd));
    dates.sort((a, b) => a.getTime() - b.getTime());
    zoomToDates(dates[0], dates[dates.length - 1]);
  };

  if (error) {
    return (
      <div className={styles.errorState}>
        <h2>Schedule Navigator unavailable</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!data || !geometry || !x) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.loadingPulse} />
        <p>Charting the route…</p>
      </div>
    );
  }

  const singletonCount = geometry.clusters.filter((c) => c.items.length === 1).length;
  const multiClusters = geometry.clusters.filter((c) => c.items.length > 1).length;

  return (
    <div className={styles.panel} ref={rootRef}>
      <div className={styles.topRow}>
        <div>
          <p className={styles.kicker}>Primary view</p>
          <h2 className={styles.title}>Schedule Navigator</h2>
          <p className={styles.lede}>
            Route-style timeline for {data.projectName}: planned baseline vs
            projected path with illustrative cascading delay. Scroll to zoom,
            drag to pan.
          </p>
        </div>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <i className={styles.swatchPlanned} /> Planned
          </span>
          <span className={styles.legendItem}>
            <i className={styles.swatchOnTime} /> Local delay · none
          </span>
          <span className={styles.legendItem}>
            <i className={styles.swatchMild} /> Mild local delay
          </span>
          <span className={styles.legendItem}>
            <i className={styles.swatchSevere} /> Severe local delay
          </span>
          <span className={styles.legendItem}>
            <ProvenanceBadge tag="FORGED" /> deviationDays
          </span>
        </div>
      </div>

      <div className={styles.callouts}>
        <div className={styles.notScheduled}>
          <strong>{data.notScheduled.count.toLocaleString()}</strong>
          <span>not scheduled</span>
          <p>{data.notScheduled.note}</p>
        </div>
        <div className={styles.forgedNote}>
          <ProvenanceBadge tag="FORGED" />
          <p>
            Delay days on markers use <code>deviationDays</code> (
            <code>deviationDaysSource</code>). Segment color = local delay at
            that waypoint; cascade still shifts projected dates rightward.
          </p>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.zoomControls}>
          <button type="button" onClick={() => zoomBy(1.35)} aria-label="Zoom in">
            Zoom in
          </button>
          <button type="button" onClick={() => zoomBy(1 / 1.35)} aria-label="Zoom out">
            Zoom out
          </button>
          <button type="button" onClick={resetZoom} aria-label="Reset zoom">
            Fit all
          </button>
        </div>
        <p className={styles.zoomMeta}>
          Zoom {transform.k.toFixed(1)}× · delay markers {singletonCount} shown
          {multiClusters > 0 ? ` · ${multiClusters} clusters` : ""} · scroll / drag
          on chart
        </p>
      </div>

      <div className={styles.stage}>
        <svg
          ref={svgRef}
          className={styles.svg}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Planned and projected schedule routes along a time axis. Scroll to zoom, drag to pan."
        >
          <defs>
            <linearGradient id="stageWash" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="55%" stopColor="#e8eef5" />
              <stop offset="100%" stopColor="#d5deea" />
            </linearGradient>
            <clipPath id="plotClip">
              <rect
                x={INNER_LEFT}
                y={MARGIN.top - 24}
                width={INNER_RIGHT - INNER_LEFT}
                height={HEIGHT - MARGIN.top - MARGIN.bottom + 48}
              />
            </clipPath>
            <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect
            x="0"
            y="0"
            width={WIDTH}
            height={HEIGHT}
            rx="18"
            fill="url(#stageWash)"
          />

          {/* Lane labels (fixed) */}
          <text
            data-anim="axis"
            x={MARGIN.left - 10}
            y={PLANNED_Y}
            className={styles.laneLabel}
            textAnchor="end"
            dominantBaseline="middle"
          >
            Planned
          </text>
          <text
            data-anim="axis"
            x={MARGIN.left - 10}
            y={PROJECTED_Y}
            className={styles.laneLabel}
            textAnchor="end"
            dominantBaseline="middle"
          >
            Projected
          </text>

          <g clipPath="url(#plotClip)">
            {Array.from({ length: 12 }).map((_, i) => {
              const gx =
                INNER_LEFT + ((INNER_RIGHT - INNER_LEFT) * i) / 11;
              return (
                <line
                  key={`g-${i}`}
                  x1={gx}
                  y1={MARGIN.top}
                  x2={gx}
                  y2={HEIGHT - MARGIN.bottom}
                  stroke="rgba(36,48,65,0.06)"
                  strokeWidth={1}
                />
              );
            })}

            <path
              data-anim="planned"
              d={geometry.plannedPath}
              fill="none"
              stroke="var(--route-planned)"
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={routesDrawn ? 1 : 0}
            />
            {geometry.plannedPts.map((p) => (
              <circle
                key={`p-${p.w.id}`}
                data-anim="marker"
                cx={p.x}
                cy={p.y}
                r={3.5}
                fill="var(--paper-glow)"
                stroke="var(--route-planned)"
                strokeWidth={1.5}
                opacity={routesDrawn ? 1 : undefined}
              />
            ))}

            {geometry.projectedSegments.map((seg) => (
              <path
                key={`seg-${seg.id}`}
                data-anim="projected"
                d={seg.d}
                fill="none"
                stroke={seg.color}
                strokeWidth={4.25}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={routesDrawn ? 1 : 0}
                filter="url(#softGlow)"
              />
            ))}

            {/* Milestone class labels */}
            {geometry.milestoneLabels
              .filter((l) => !l.hidden)
              .map((l) => (
                <text
                  key={l.id}
                  data-anim="axis"
                  x={l.x}
                  y={l.y}
                  className={styles.milestoneLabel}
                  textAnchor={l.anchor}
                >
                  {l.text}
                </text>
              ))}

            {/* Delay clusters / markers */}
            {geometry.clusters.map((c) => {
              const isCluster = c.items.length > 1;
              return (
                <g
                  key={c.id}
                  data-anim="marker"
                  data-interactive="true"
                  className={styles.markerHit}
                  onMouseEnter={() =>
                    setHover(
                      isCluster
                        ? { kind: "cluster", cluster: c, x: c.x, y: c.y }
                        : {
                            kind: "delay",
                            waypoint: c.items[0].w,
                            x: c.x,
                            y: c.y,
                          }
                    )
                  }
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onClusterActivate(c)}
                >
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={isCluster ? 14 : 9}
                    fill={c.color}
                    fillOpacity={0.16}
                  />
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={isCluster ? 8 : 5}
                    fill={c.color}
                    stroke="var(--paper-glow)"
                    strokeWidth={2}
                  />
                  {isCluster && (
                    <text
                      x={c.x}
                      y={c.y + 1}
                      className={styles.clusterBadge}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      {c.items.length}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Delay day labels for singletons */}
            {geometry.delayLabels
              .filter((l) => !l.hidden)
              .map((l) => (
                <text
                  key={l.id}
                  data-anim="axis"
                  x={l.x}
                  y={l.y}
                  className={styles.markerLabel}
                  textAnchor={l.anchor}
                >
                  {l.text}
                </text>
              ))}
          </g>

          {/* Time axis (ticks follow zoom) */}
          <line
            data-anim="axis"
            x1={INNER_LEFT}
            y1={HEIGHT - MARGIN.bottom + 8}
            x2={INNER_RIGHT}
            y2={HEIGHT - MARGIN.bottom + 8}
            stroke="var(--ink-soft)"
            strokeWidth={1.25}
            strokeOpacity={0.45}
          />
          {geometry.ticks.map((t) => {
            const tx = x(t);
            if (tx < INNER_LEFT - 4 || tx > INNER_RIGHT + 4) return null;
            return (
              <g key={t.toISOString()} data-anim="axis">
                <line
                  x1={tx}
                  y1={HEIGHT - MARGIN.bottom + 4}
                  x2={tx}
                  y2={HEIGHT - MARGIN.bottom + 12}
                  stroke="var(--ink-soft)"
                  strokeWidth={1}
                />
                <text
                  x={tx}
                  y={HEIGHT - MARGIN.bottom + 30}
                  className={styles.tick}
                  textAnchor="middle"
                >
                  {formatTick(t)}
                </text>
              </g>
            );
          })}
        </svg>

        {hover?.kind === "delay" && (
          <div
            className={styles.tooltip}
            style={{
              left: `${(hover.x / WIDTH) * 100}%`,
              top: `${(hover.y / HEIGHT) * 100}%`,
            }}
          >
            <div className={styles.tooltipHead}>
              <span>{hover.waypoint.taskNameEn}</span>
              <ProvenanceBadge tag="FORGED" compact />
            </div>
            <p className={styles.tooltipMeta}>
              {hover.waypoint.milestoneClass} · {severityLabel(hover.waypoint.severity)}
            </p>
            <ul>
              <li>
                Local delay: <strong>+{hover.waypoint.localDelayDays} days</strong>{" "}
                <ProvenanceBadge tag="FORGED" compact />
              </li>
              <li>
                Source: <code>{hover.waypoint.deviationDaysSource}</code>
              </li>
              <li>
                Cascade before: +{hover.waypoint.cascadeShiftBefore}d → projected{" "}
                {hover.waypoint.projectedEnd}
              </li>
              <li>
                Behind {hover.waypoint.counts.behind} · on-time{" "}
                {hover.waypoint.counts.onTime} · delayed comps{" "}
                {hover.waypoint.counts.delayedComponents}
              </li>
            </ul>
            <p className={styles.tooltipHint}>
              Scroll-zoom or use Zoom in for more label room
            </p>
          </div>
        )}

        {hover?.kind === "cluster" && (
          <div
            className={styles.tooltip}
            style={{
              left: `${(hover.x / WIDTH) * 100}%`,
              top: `${(hover.y / HEIGHT) * 100}%`,
            }}
          >
            <div className={styles.tooltipHead}>
              <span>{hover.cluster.items.length} delays in this zone</span>
            </div>
            <ul>
              {[...hover.cluster.items]
                .sort(
                  (a, b) =>
                    severityRank(b.w.severity) - severityRank(a.w.severity) ||
                    b.w.localDelayDays - a.w.localDelayDays
                )
                .slice(0, 5)
                .map((it) => (
                  <li key={it.w.id}>
                    +{it.w.localDelayDays}d · {it.w.taskNameEn}
                  </li>
                ))}
              {hover.cluster.items.length > 5 && (
                <li>+{hover.cluster.items.length - 5} more…</li>
              )}
            </ul>
            <p className={styles.tooltipHint}>Click cluster to zoom into this zone</p>
          </div>
        )}
      </div>

      <footer className={styles.footnotes}>
        {data.footnotes.map((note) => (
          <p key={note.slice(0, 48)}>{note}</p>
        ))}
      </footer>
    </div>
  );
}
