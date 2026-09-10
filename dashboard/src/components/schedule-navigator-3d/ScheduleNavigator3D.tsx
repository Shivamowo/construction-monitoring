"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type {
  DelayCategory,
  DelaySeverity,
  NavigatorWaypoint,
  ScheduleNavigatorPayload,
} from "@/lib/schedule-navigator/aggregate";
import {
  buildScrubSnapshot,
  formatScrubDay,
  fractionToScrubIso,
  scrubIsoToFraction,
  type ScrubSnapshot,
} from "@/lib/schedule-navigator/scrubSnapshot";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import {
  createJourneyController,
  type JourneyController,
} from "./scene/journeyController";
import { formatDay } from "./scene/timelineAxis";
import styles from "./ScheduleNavigator3D.module.css";

type ProvenanceTag = "FORGED" | "REAL" | "DERIVED";

function tagFromDeviationSource(
  source: NavigatorWaypoint["deviationDaysSource"]
): ProvenanceTag {
  if (source === "derived") return "DERIVED";
  return "FORGED";
}

function severityRank(s: NavigatorWaypoint["severity"]): number {
  return s === "severe" ? 2 : s === "mild" ? 1 : 0;
}

function routeScore(waypoint: NavigatorWaypoint): number {
  const plan = waypoint.catchUpPlan;
  if (!plan || plan.daysRecovered <= 0) return -Infinity;
  const costBurden = Math.max(1, plan.resourceCost.split(",").length + plan.resourceCost.length / 100);
  return plan.daysRecovered / costBurden;
}

const FLOATING_CARD_WIDTH = 300;
const FLOATING_CARD_OFFSET_X = 26;
const FLOATING_CARD_OFFSET_Y = -60;
const FLOATING_CARD_EST_HEIGHT = 320;
const VIEWPORT_MARGIN = 12;

/** Clamp the floating card's top-left to stay fully on-screen while still
 * favoring a position near (offset from) the anchor point. */
function clampCardPosition(anchorX: number, anchorY: number) {
  const maxLeft =
    (typeof window !== "undefined" ? window.innerWidth : 1200) -
    FLOATING_CARD_WIDTH -
    VIEWPORT_MARGIN;
  const maxTop =
    (typeof window !== "undefined" ? window.innerHeight : 800) -
    FLOATING_CARD_EST_HEIGHT -
    VIEWPORT_MARGIN;
  const left = Math.min(
    Math.max(anchorX + FLOATING_CARD_OFFSET_X, VIEWPORT_MARGIN),
    Math.max(maxLeft, VIEWPORT_MARGIN)
  );
  const top = Math.min(
    Math.max(anchorY + FLOATING_CARD_OFFSET_Y, VIEWPORT_MARGIN),
    Math.max(maxTop, VIEWPORT_MARGIN)
  );
  return { left, top };
}

export function ScheduleNavigator3D() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const axisOverlayRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<JourneyController | null>(null);
  const scrubberTrackRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const isDraggingScrubberRef = useRef(false);

  const [data, setData] = useState<ScheduleNavigatorPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NavigatorWaypoint | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<NavigatorWaypoint | null>(null);
  const [clusterItems, setClusterItems] = useState<NavigatorWaypoint[]>([]);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [takenRoutes, setTakenRoutes] = useState<Set<string>>(new Set());
  const [shardTotal, setShardTotal] = useState(0);
  const [clusterTotal, setClusterTotal] = useState(0);
  const [status, setStatus] = useState("Loading schedule…");
  const [booting, setBooting] = useState(true);
  const [bootProgress, setBootProgress] = useState(0);
  const [scrubIso, setScrubIso] = useState<string | null>(null);
  const [projectedEndIso, setProjectedEndIso] = useState<string | null>(null);
  const [activeCategories, setActiveCategories] = useState<DelayCategory[]>([]);
  const [activeSeverities, setActiveSeverities] = useState<DelaySeverity[]>([]);
  const [criticalPathVisible, setCriticalPathVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cardAnchor, setCardAnchor] = useState<
    { x: number; y: number; onScreen: boolean } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    const boot = { p: 0 };
    const tween = gsap.to(boot, {
      p: 1,
      duration: 0.85,
      ease: "power2.inOut",
      onUpdate: () => {
        if (!cancelled) setBootProgress(boot.p);
      },
    });

    (async () => {
      try {
        const res = await fetch("/api/schedule-navigator");
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as ScheduleNavigatorPayload;
        if (!cancelled) {
          setData(json);
          setStatus("Loading scene…");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setBooting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      tween.kill();
    };
  }, []);

  useEffect(() => {
    if (!data || !hostRef.current || !canvasRef.current || !axisOverlayRef.current)
      return;

    const host = hostRef.current;
    const canvas = canvasRef.current;
    const width = host.clientWidth || 960;
    const height = host.clientHeight || 560;

    const controller = createJourneyController(
      canvas,
      width,
      height,
      {
        waypoints: data.waypoints,
        timeline: data.timeline,
        axisOverlay: axisOverlayRef.current,
        axisClassNames: {
          month: styles.axisMonth,
          key: styles.axisKey,
          today: styles.axisToday,
          title: styles.axisTitle,
          sub: styles.axisSub,
          playhead: styles.playhead,
        },
      },
      {
        onClusterSelect: ({ representative, items }) => {
          setClusterItems(items);
          setSelected(representative);
          setSelectedRoute(null);
          setRecoveryOpen(false);
          setStatus("Delay detail open");
        },
        onForecastSelect: (waypoint) => {
          setClusterItems([]);
          setSelected(waypoint);
          setSelectedRoute(null);
          setRecoveryOpen(false);
          setStatus("Predicted risk detail open");
        },
        onRouteSelect: (waypoint) => {
          setClusterItems([]);
          setSelected(null);
          setSelectedRoute(waypoint);
          setRecoveryOpen(false);
          setStatus("Alternate route detail open");
        },
        onSceneReady: () => {
          setBooting(false);
          setBootProgress(1);
          setStatus("Drag the playhead or click a date · orbit to inspect");
          controller.setHoverEnabled(true);
        },
        onCatchUpComplete: ({
          daysRecovered,
          daysLost,
          appliedCount,
          projectedEnd,
          daysBehind,
        }) => {
          setProjectedEndIso(projectedEnd);
          if (daysRecovered <= 0) {
            setStatus("No catch-up plan on this delay — projected path unchanged");
            return;
          }
          const ratio = daysLost > 0 ? Math.round((daysRecovered / daysLost) * 100) : 0;
          setStatus(
            `Catch-up applied: recovered ${daysRecovered} of ${daysLost}d (~${ratio}% of local gap). Projected finish moved to ${formatDay(projectedEnd)} (+${daysBehind}d). ${appliedCount} plan${appliedCount === 1 ? "" : "s"} active.`
          );
        },
        onScrubChange: (iso) => {
          setScrubIso(iso);
        },
      }
    );
    controllerRef.current = controller;
    setShardTotal(controller.shardCount);
    setClusterTotal(controller.clusterCount);

    const onResize = () => {
      if (!hostRef.current || !controllerRef.current) return;
      controllerRef.current.setSize(
        hostRef.current.clientWidth,
        hostRef.current.clientHeight
      );
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      controller.dispose();
      controllerRef.current = null;
    };
  }, [data]);

  useEffect(() => {
    controllerRef.current?.setShardFilter({
      categories: activeCategories,
      severities: activeSeverities,
    });
  }, [activeCategories, activeSeverities]);

  useEffect(() => {
    controllerRef.current?.setCriticalPathVisible(criticalPathVisible);
  }, [criticalPathVisible]);

  // Real Fullscreen API (not a CSS-only fake) on .stage — canvas + status
  // bar + legend + filter chips all live under it, so this brings the whole
  // chrome along and leaves the outer app shell/nav behind.
  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === stageRef.current;
      setIsFullscreen(active);
      // The browser resizes .stage synchronously with the fullscreenchange
      // event, but layout/reflow of its descendants (and therefore
      // hostRef's new clientWidth/clientHeight) isn't guaranteed settled
      // until the next frame — resize on both this tick and the next to
      // avoid a one-frame-stale WebGL canvas/aspect ratio.
      const resize = () => {
        if (!hostRef.current || !controllerRef.current) return;
        controllerRef.current.setSize(
          hostRef.current.clientWidth,
          hostRef.current.clientHeight
        );
      };
      resize();
      requestAnimationFrame(resize);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      stageRef.current?.requestFullscreen().catch(() => {
        // Fullscreen can be denied (permissions policy, user gesture
        // requirements not met, etc.) — fail silently, UI state stays
        // in sync via fullscreenchange (which won't fire, so isFullscreen
        // correctly remains false).
      });
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    if ((!selected && !selectedRoute) || !cardRef.current) return;
    gsap.fromTo(
      cardRef.current,
      { autoAlpha: 0, y: 8 },
      { autoAlpha: 1, y: 0, duration: 0.28, ease: "expo.out" }
    );
  }, [selected?.id, selectedRoute?.id, clusterItems.length]);

  // Live-track the card's anchor point in the scene each frame while a
  // shard/route is selected, so the card and its leader line stay pinned to
  // the subject as the camera orbits/reframes instead of sitting in a fixed
  // corner disconnected from what was clicked.
  useEffect(() => {
    if (!selected && !selectedRoute) {
      setCardAnchor(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      const controller = controllerRef.current;
      const host = hostRef.current;
      if (!controller || !host) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const local = selectedRoute
        ? controller.getRouteScreenAnchor(selectedRoute.id)
        : controller.getShardScreenAnchor();
      if (!local) {
        setCardAnchor(null);
      } else {
        const hostRect = host.getBoundingClientRect();
        setCardAnchor({
          x: hostRect.left + local.x,
          y: hostRect.top + local.y,
          onScreen: local.onScreen,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selected?.id, selectedRoute?.id]);

  // Legend reads top-to-bottom as a short staggered reveal on first render —
  // motion with a purpose (draws the eye down the key once) rather than a
  // static list appearing all at once. Visual only; runs once per mount.
  useEffect(() => {
    if (!data || !legendRef.current) return;
    const items = legendRef.current.querySelectorAll("li");
    gsap.fromTo(
      items,
      { autoAlpha: 0, y: 6 },
      { autoAlpha: 1, y: 0, duration: 0.32, ease: "power2.out", stagger: 0.06 }
    );
  }, [data]);

  useEffect(() => {
  }, [scrubIso]);

  const recommendedRoute = useMemo(
    () => data
      ? data.waypoints
          .filter((waypoint) => waypoint.catchUpPlan && waypoint.catchUpPlan.daysRecovered > 0)
          .sort((a, b) => routeScore(b) - routeScore(a))[0] ?? null
      : null,
    [data]
  );

  const scrub: ScrubSnapshot | null = useMemo(() => {
    if (!data) return null;
    const iso = scrubIso ?? data.timeline.asOf ?? data.timeline.start;
    return buildScrubSnapshot(data, iso);
  }, [data, scrubIso]);

  const effectiveProjectedEnd =
    projectedEndIso ?? data?.timeline.projectedEnd ?? "";

  const timelineEffective = useMemo(() => {
    if (!data) return null;
    return {
      ...data.timeline,
      projectedEnd: effectiveProjectedEnd ?? data.timeline.projectedEnd,
    };
  }, [data, effectiveProjectedEnd]);

  const delayMarkers = useMemo(() => {
    if (!data || !timelineEffective) return [];
    return data.waypoints
      .filter((w) => w.localDelayDays > 0)
      .map((w) => ({
        id: w.id,
        fraction: scrubIsoToFraction(w.plannedEnd, timelineEffective),
        waypoint: w,
      }));
  }, [data, timelineEffective]);

  const forecastMarkers = useMemo(() => {
    if (!data || !timelineEffective) return [];
    return data.waypoints
      .filter((w) => w.forecastRisk)
      .map((w) => ({
        id: w.id,
        fraction: scrubIsoToFraction(w.plannedEnd, timelineEffective),
        waypoint: w,
      }));
  }, [data, timelineEffective]);

  const updateScrubFromPointer = (clientX: number) => {
    const track = scrubberTrackRef.current;
    if (!track || !timelineEffective) return;
    const rect = track.getBoundingClientRect();
    const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const iso = fractionToScrubIso(fraction, timelineEffective);
    controllerRef.current?.setScrubIso(iso);
  };

  const onScrubberPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    isDraggingScrubberRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    controllerRef.current?.setScrubbing(true);
    updateScrubFromPointer(e.clientX);
  };

  const onScrubberPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingScrubberRef.current) return;
    updateScrubFromPointer(e.clientX);
  };

  const onScrubberPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingScrubberRef.current) return;
    isDraggingScrubberRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    controllerRef.current?.setScrubbing(false);
  };

  const onTakeRoute = () => {
    if (!selectedRoute?.catchUpPlan) return;
    setRecoveryOpen(true);
    const { daysRecovered, daysLost } = selectedRoute.catchUpPlan;
    setStatus(
      `Route taken: recovering ${daysRecovered} of ${daysLost} days at ${selectedRoute.taskNameEn}…`
    );
    controllerRef.current?.applyCatchUpPlan(selectedRoute.id);
    setTakenRoutes((prev) => {
      const next = new Set(prev);
      next.add(selectedRoute.id);
      return next;
    });
  };

  if (error) {
    return (
      <div className={styles.root}>
        <div className={styles.error}>Failed to load navigator data: {error}</div>
      </div>
    );
  }

  if (!data || !scrub || !timelineEffective) {
    return (
      <div className={styles.root}>
        <div className={styles.preloader} aria-busy="true">
          <p className={styles.preloaderBrand}>Schedule Navigator</p>
          <div className={styles.preloaderTrack}>
            <div
              className={styles.preloaderBar}
              style={{ transform: `scaleX(${Math.max(bootProgress, 0.08)})` }}
            />
          </div>
          <p className={styles.preloaderMeta}>Loading schedule…</p>
        </div>
      </div>
    );
  }

  const timeLostTag = selected
    ? tagFromDeviationSource(selected.deviationDaysSource)
    : "FORGED";
  const isCluster = clusterItems.length > 1;
  const isForecast = Boolean(selected?.forecastRisk);
  const hasCatchUp = Boolean(
    selected?.catchUpPlan && selected.catchUpPlan.daysRecovered > 0
  );
  const routeTaken = Boolean(selectedRoute && takenRoutes.has(selectedRoute.id));

  const toggleCategory = (category: DelayCategory) => {
    setActiveCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    );
  };
  const toggleSeverity = (severity: DelaySeverity) => {
    setActiveSeverities((current) =>
      current.includes(severity)
        ? current.filter((item) => item !== severity)
        : [...current, severity]
    );
  };

  const currentScrubFraction = scrubIsoToFraction(
    scrub.scrubIso,
    timelineEffective
  );
  const todayFraction = scrubIsoToFraction(
    scrub.todayIso,
    timelineEffective
  );
  const plannedEndFraction = scrubIsoToFraction(
    data.timeline.end,
    timelineEffective
  );

  return (
    <div className={styles.root}>
      <div className={styles.stage} ref={stageRef}>
        <div className={styles.viewportColumn}>
          <div className={styles.viewport} ref={hostRef}>
          <canvas ref={canvasRef} className={styles.canvas} />
          <button
            type="button"
            className={styles.fullscreenBtn}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 3v4a1 1 0 0 1-1 1H4" />
                <path d="M20 9h-4a1 1 0 0 1-1-1V4" />
                <path d="M15 21v-4a1 1 0 0 1 1-1h4" />
                <path d="M4 15h4a1 1 0 0 1 1 1v4" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8V5a1 1 0 0 1 1-1h3" />
                <path d="M16 4h3a1 1 0 0 1 1 1v3" />
                <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
                <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
              </svg>
            )}
          </button>
          <div className={styles.filterOverlay} aria-label="Delay shard filters">
            <span className={styles.filterLabel}>Shards</span>
            <button type="button" className={!activeCategories.length ? `${styles.filterChip} ${styles.filterChipActive}` : styles.filterChip} aria-pressed={!activeCategories.length} onClick={() => setActiveCategories([])}>All</button>
            {(["customs", "weather", "labor"] as DelayCategory[]).map((category) => (
              <button key={category} type="button" className={activeCategories.includes(category) ? `${styles.filterChip} ${styles.filterChipActive}` : styles.filterChip} aria-pressed={activeCategories.includes(category)} onClick={() => toggleCategory(category)}>{category}</button>
            ))}
            <span className={styles.filterDivider} />
            {(["mild", "severe"] as DelaySeverity[]).map((severity) => (
              <button key={severity} type="button" className={activeSeverities.includes(severity) ? `${styles.filterChip} ${styles.filterChipActive}` : styles.filterChip} aria-pressed={activeSeverities.includes(severity)} onClick={() => toggleSeverity(severity)}>{severity}</button>
            ))}
            <span className={styles.filterDivider} />
            <button type="button" className={criticalPathVisible ? `${styles.filterChip} ${styles.filterChipActive}` : styles.filterChip} aria-pressed={criticalPathVisible} onClick={() => setCriticalPathVisible((v) => !v)}>critical path</button>
            <span className={styles.filterProvenance}>DERIVED</span>
          </div>
          <div
            ref={axisOverlayRef}
            className={styles.axisOverlay}
            aria-hidden
          />

          <div className={styles.zoomControls} role="group" aria-label="Camera zoom">
            <button
              type="button"
              className={styles.zoomBtn}
              aria-label="Zoom in"
              onClick={() => controllerRef.current?.zoomIn()}
            >
              +
            </button>
            <button
              type="button"
              className={styles.zoomBtn}
              aria-label="Zoom out"
              onClick={() => controllerRef.current?.zoomOut()}
            >
              −
            </button>
          </div>

          {booting && (
            <div className={styles.bootOverlay} aria-busy="true">
              <p className={styles.preloaderBrand}>Schedule Navigator</p>
              <div className={styles.preloaderTrack}>
                <div
                  className={styles.preloaderBar}
                  style={{ transform: `scaleX(${Math.max(bootProgress, 0.12)})` }}
                />
              </div>
            </div>
          )}

          <div className={styles.hud}>
            <p className={styles.status}>
              <strong>{status}</strong>
            </p>
          </div>

        </div>

        <div
          className={styles.scrubberContainer}
          role="region"
          aria-label="Timeline navigation bar"
        >
          <div className={styles.scrubberHeader}>
            <span className={styles.scrubberLabel}>
              Start{" "}
              <strong className={styles.scrubberDate}>
                {formatDay(data.timeline.start)}
              </strong>
            </span>
            <span
              className={
                scrub.isProjectedZone
                  ? `${styles.scrubberCurrentTag} ${styles.scrubberCurrentTagProjected}`
                  : styles.scrubberCurrentTag
              }
            >
              {formatDay(scrub.scrubIso)}
              {scrub.scrubIso === scrub.todayIso
                ? " · Today"
                : scrub.isProjectedZone
                  ? " · Projected"
                  : " · Actual"}
            </span>
            <span className={styles.scrubberLabel}>
              Projected Finish{" "}
              <strong className={styles.scrubberDate}>
                {formatDay(timelineEffective.projectedEnd)}
              </strong>
            </span>
          </div>

          <div
            className={styles.scrubberTrackArea}
            ref={scrubberTrackRef}
            onPointerDown={onScrubberPointerDown}
            onPointerMove={onScrubberPointerMove}
            onPointerUp={onScrubberPointerUp}
            onPointerCancel={onScrubberPointerUp}
            role="slider"
            aria-label="Timeline scrubber"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(currentScrubFraction * 100)}
            aria-valuetext={formatDay(scrub.scrubIso)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                const delta = e.key === "ArrowLeft" ? -0.02 : 0.02;
                const nextFraction = Math.min(Math.max(currentScrubFraction + delta, 0), 1);
                const iso = fractionToScrubIso(nextFraction, timelineEffective);
                controllerRef.current?.setScrubIso(iso);
              }
            }}
          >
            <div className={styles.scrubberRail}>
              {/* Actual progress track */}
              <div
                className={styles.scrubberProgressActual}
                style={{
                  width: `${Math.min(currentScrubFraction, todayFraction) * 100}%`,
                }}
              />
              {/* Projected progress track (if scrubbed past today) */}
              {currentScrubFraction > todayFraction && (
                <div
                  className={styles.scrubberProgressProjected}
                  style={{
                    left: `${todayFraction * 100}%`,
                    width: `${(currentScrubFraction - todayFraction) * 100}%`,
                  }}
                />
              )}

              {/* Today tick */}
              <div
                className={`${styles.scrubberTick} ${styles.scrubberTickToday}`}
                style={{ left: `${todayFraction * 100}%` }}
                title={`Today: ${formatDay(scrub.todayIso)}`}
              />

              {/* Planned End tick (if distinct from projected) */}
              {plannedEndFraction < 1 && (
                <div
                  className={`${styles.scrubberTick} ${styles.scrubberTickPlanned}`}
                  style={{ left: `${plannedEndFraction * 100}%` }}
                  title={`Planned end: ${formatDay(data.timeline.end)}`}
                />
              )}

              {/* Projected End tick */}
              <div
                className={`${styles.scrubberTick} ${styles.scrubberTickProjected}`}
                style={{ left: `100%` }}
                title={`Projected finish: ${formatDay(timelineEffective.projectedEnd)}`}
              />

              {/* Delay Shards */}
              {delayMarkers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={styles.scrubberShardMark}
                  style={{ left: `${m.fraction * 100}%` }}
                  title={`${m.waypoint.taskNameEn} (+${m.waypoint.localDelayDays}d)`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(m.waypoint);
                    setSelectedRoute(null);
                    setClusterItems([]);
                    setRecoveryOpen(false);
                    controllerRef.current?.setScrubIso(m.waypoint.plannedEnd);
                  }}
                  aria-label={`Delay: ${m.waypoint.taskNameEn}, +${m.waypoint.localDelayDays} days`}
                />
              ))}

              {/* Forecasted-risk shards — predicted, not yet happened */}
              {forecastMarkers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={styles.scrubberForecastMark}
                  style={{ left: `${m.fraction * 100}%` }}
                  title={`${m.waypoint.taskNameEn} — predicted risk (+${m.waypoint.forecastRisk?.predictedDelayDays}d)`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(m.waypoint);
                    setSelectedRoute(null);
                    setClusterItems([]);
                    setRecoveryOpen(false);
                    controllerRef.current?.setScrubIso(m.waypoint.plannedEnd);
                  }}
                  aria-label={`Predicted risk: ${m.waypoint.taskNameEn}, +${m.waypoint.forecastRisk?.predictedDelayDays} days`}
                />
              ))}
            </div>

            {/* Draggable Playhead Thumb */}
            <div
              className={
                scrub.isProjectedZone
                  ? `${styles.scrubberThumb} ${styles.scrubberThumbProjected}`
                  : styles.scrubberThumb
              }
              style={{
                left: `${Math.min(Math.max(currentScrubFraction, 0), 1) * 100}%`,
              }}
            >
              <span className={styles.scrubberThumbHairline} />
              <span className={styles.scrubberThumbGrip} />
            </div>
          </div>
        </div>
      </div>

      {(selectedRoute || selected) && cardAnchor && (() => {
        const { left, top } = clampCardPosition(cardAnchor.x, cardAnchor.y);
        const cardCenterY = top + 40;
        const leaderTargetX = cardAnchor.x < left ? left : left + FLOATING_CARD_WIDTH;
        return (
          <>
            <svg
              className={styles.leaderLineSvg}
              aria-hidden
              style={{ opacity: cardAnchor.onScreen ? 1 : 0 }}
            >
              <line
                x1={cardAnchor.x}
                y1={cardAnchor.y}
                x2={leaderTargetX}
                y2={cardCenterY}
                className={styles.leaderLine}
              />
              <circle
                cx={cardAnchor.x}
                cy={cardAnchor.y}
                r={4}
                className={styles.leaderDot}
              />
            </svg>
            <div
              className={styles.routeSection}
              style={{
                position: "fixed",
                left,
                top,
                width: FLOATING_CARD_WIDTH,
                opacity: cardAnchor.onScreen ? 1 : 0,
                pointerEvents: cardAnchor.onScreen ? "auto" : "none",
              }}
              aria-live="polite"
              ref={cardRef}
            >
          {selectedRoute ? (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h3 className={styles.cardTitle}>Alternate route</h3>
                  <p className={styles.cardMeta}>
                    {selectedRoute.milestoneClass} · {selectedRoute.taskNameEn}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.closeBtn}
                  aria-label="Close"
                  onClick={() => {
                    setSelectedRoute(null);
                    setRecoveryOpen(false);
                  }}
                >
                  ×
                </button>
              </div>
              {recommendedRoute?.id === selectedRoute.id && (
                <div className={styles.recommendationBadge}>
                  Computed suggestion · DERIVED
                  <span>
                    Recommended: recovers {selectedRoute.catchUpPlan?.daysRecovered}d at the lowest computed cost burden.
                  </span>
                </div>
              )}
              {recommendedRoute && recommendedRoute.id !== selectedRoute.id && (
                <div className={styles.recommendationNote}>
                  Computed suggestion · DERIVED: <strong>{recommendedRoute.taskNameEn}</strong> recovers {recommendedRoute.catchUpPlan?.daysRecovered}d with the strongest recovery-to-cost score.
                </div>
              )}

              {selectedRoute.catchUpPlan && (
                <>
                  <div className={styles.routeCompare}>
                    <div className={styles.routeOption}>
                      <p className={styles.routeOptionLabel}>Current path</p>
                      <p className={styles.routeOptionMeta}>
                        {routeTaken ? "Superseded — see ghosted line" : "No change · status quo"}
                      </p>
                    </div>
                    <span className={styles.routeOptionDivider}>vs</span>
                    <div className={`${styles.routeOption} ${styles.routeOptionSuggested}`}>
                      <p className={styles.routeOptionLabel}>
                        {routeTaken ? "Route taken" : "Suggested route"}
                      </p>
                      <p className={styles.routeOptionMeta}>
                        −{selectedRoute.catchUpPlan.daysRecovered}d ·{" "}
                        {selectedRoute.catchUpPlan.resourceCost}
                      </p>
                    </div>
                  </div>

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={onTakeRoute}
                      disabled={routeTaken}
                    >
                      {routeTaken
                        ? "Route taken ✓"
                        : `Take this route (−${selectedRoute.catchUpPlan.daysRecovered}d)`}
                    </button>
                  </div>

                  {recoveryOpen && (
                    <div className={styles.recovery}>
                      <p className={styles.fieldLabel}>
                        Recovery
                        <ProvenanceBadge tag="FORGED" compact />
                      </p>
                      <p>{selectedRoute.catchUpPlan.summary}</p>
                      <p className={styles.placeholderNote}>
                        Partial correction only: {selectedRoute.catchUpPlan.daysRecovered} of{" "}
                        {selectedRoute.catchUpPlan.daysLost} days recovered (
                        {Math.round(
                          (selectedRoute.catchUpPlan.daysRecovered /
                            Math.max(selectedRoute.catchUpPlan.daysLost, 1)) *
                            100
                        )}
                        % of this local gap). Other delays keep their own residual.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : selected ? (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h3 className={styles.cardTitle}>
                    {isCluster
                      ? `${clusterItems.length} delays in this zone`
                      : selected.taskNameEn}
                  </h3>
                  <p className={styles.cardMeta}>
                    {isCluster
                      ? `Focus · ${selected.taskNameEn}`
                      : `${selected.milestoneClass} · ${selected.taskName}`}
                    {isForecast && (
                      <span className={styles.forecastTag}>Predicted</span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.closeBtn}
                  aria-label="Close"
                  onClick={() => {
                    setSelected(null);
                    setClusterItems([]);
                    setRecoveryOpen(false);
                  }}
                >
                  ×
                </button>
              </div>

              {isCluster && (
                <ul className={styles.clusterList}>
                  {[...clusterItems]
                    .sort(
                      (a, b) =>
                        severityRank(b.severity) - severityRank(a.severity) ||
                        b.localDelayDays - a.localDelayDays
                    )
                    .map((w) => (
                      <li key={w.id}>
                        <button
                          type="button"
                          className={
                            w.id === selected.id
                              ? styles.clusterItemActive
                              : styles.clusterItem
                          }
                          onClick={() => {
                            setSelected(w);
                            setRecoveryOpen(false);
                          }}
                        >
                          <span>+{w.localDelayDays}d</span>
                          <span>{w.taskNameEn}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}

              <div className={styles.field}>
                <p className={styles.fieldLabel}>
                  {isForecast ? "Predicted time lost (if risk occurs)" : "Time lost"}
                  <ProvenanceBadge tag={isForecast ? "FORGED" : timeLostTag} compact />
                </p>
                <p className={styles.fieldBody}>
                  <strong>
                    +{isForecast
                      ? selected.forecastRisk!.predictedDelayDays
                      : selected.localDelayDays}{" "}
                    days
                  </strong>
                  {isForecast ? (
                    <>
                      {" · "}
                      risk <code>{selected.forecastRisk!.riskLevel}</code>
                    </>
                  ) : (
                    <>
                      {" · "}
                      source <code>{selected.deviationDaysSource}</code>
                    </>
                  )}
                </p>
              </div>

              <div className={styles.field}>
                <p className={styles.fieldLabel}>
                  {isForecast ? "Forecast" : "Reason"}
                  <ProvenanceBadge tag="FORGED" compact />
                </p>
                <p className={styles.fieldBody}>
                  {isForecast
                    ? selected.forecastRisk!.reason
                    : (selected.delayReason ??
                      "No delay reason recorded for this waypoint.")}
                </p>
              </div>

              {hasCatchUp && (
                <p className={styles.placeholderNote}>
                  An alternate route exists for this delay — click its dashed line
                  on the path to view cost and take it.
                </p>
              )}
            </div>
          ) : null}
            </div>
          </>
        );
      })()}

      <aside className={styles.sidePanel} aria-label="Legend">
        <div className={styles.legendSection} ref={legendRef}>
          <p className={styles.legendTitle}>Legend</p>
          <ul className={styles.legendList}>
            <li>
              <i className={styles.swatchPlanned} /> Planned reference
            </li>
            <li>
              <i className={styles.swatchActual} /> Actual to date
            </li>
            <li>
              <i className={styles.swatchProjected} /> Projected (at risk)
            </li>
            <li>
              <i className={styles.swatchAlternate} /> Alternate route (click to view)
            </li>
            <li>
              <i className={styles.swatchTaken} /> Route taken
            </li>
            <li>
              <i className={styles.swatchGhost} /> Ghosted (superseded route)
            </li>
            <li>
              <i className={styles.swatchToday} /> Today
            </li>
            <li>
              <i className={styles.swatchShard} /> Delay indicator
            </li>
            <li>
              <i className={styles.swatchForecast} /> Predicted risk
            </li>
            <li>
              <i className={styles.swatchCritical} /> Critical path driver · zero float
            </li>
            <li>
              <i className={styles.swatchSlack} /> Slack segment · DERIVED
            </li>
            <li>
              <i className={styles.swatchMilestone} /> Structural milestone
            </li>
          </ul>
        </div>
      </aside>
      </div>
    </div>
  );
}
