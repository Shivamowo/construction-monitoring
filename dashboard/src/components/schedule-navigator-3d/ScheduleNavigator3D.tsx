"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type {
  NavigatorWaypoint,
  ScheduleNavigatorPayload,
} from "@/lib/schedule-navigator/aggregate";
import { buildStatusSummary } from "@/lib/schedule-navigator/statusSummary";
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

function formatSlip(days: number | null): string {
  if (days == null) return "—";
  if (days === 0) return "On plan";
  if (days > 0) return `${days}d behind`;
  return `${Math.abs(days)}d ahead`;
}

export function ScheduleNavigator3D() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const axisOverlayRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<JourneyController | null>(null);
  const scrubBodyRef = useRef<HTMLDivElement | null>(null);
  const scrubberTrackRef = useRef<HTMLDivElement | null>(null);
  const isDraggingScrubberRef = useRef(false);

  const [data, setData] = useState<ScheduleNavigatorPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NavigatorWaypoint | null>(null);
  const [clusterItems, setClusterItems] = useState<NavigatorWaypoint[]>([]);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [shardTotal, setShardTotal] = useState(0);
  const [clusterTotal, setClusterTotal] = useState(0);
  const [status, setStatus] = useState("Loading schedule…");
  const [booting, setBooting] = useState(true);
  const [bootProgress, setBootProgress] = useState(0);
  const [scrubIso, setScrubIso] = useState<string | null>(null);
  const [projectedEndIso, setProjectedEndIso] = useState<string | null>(null);
  const [activeDaysBehind, setActiveDaysBehind] = useState<number | null>(null);

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
          setRecoveryOpen(false);
          setStatus("Delay detail open");
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
          setActiveDaysBehind(daysBehind);
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
    if (!selected || !cardRef.current) return;
    gsap.fromTo(
      cardRef.current,
      { autoAlpha: 0, y: 8 },
      { autoAlpha: 1, y: 0, duration: 0.28, ease: "expo.out" }
    );
  }, [selected?.id, clusterItems.length]);

  // Anchor the detail card as a popover near the selected shard's projected
  // screen position. We chose the "track live" scope option: it follows the
  // shard on orbit / scrub reframe instead of closing on camera movement.
  useEffect(() => {
    if (!selected) return;
    const controller = controllerRef.current;
    if (!controller) return;
    const GAP = 14;
    const PAD = 10;
    let raf = 0;
    let cardW = 0;
    let cardH = 0;
    const tick = () => {
      const el = cardRef.current;
      const host = hostRef.current;
      const anchor = controller.getShardScreenAnchor();
      if (el && host && anchor) {
        if (cardW <= 0) cardW = el.offsetWidth;
        if (cardH <= 0) cardH = el.offsetHeight;
        const hostW = host.clientWidth;
        const clampedW = Math.min(cardW, Math.max(hostW - PAD * 2, 0));
        let x = anchor.x - clampedW / 2;
        x = Math.min(Math.max(x, PAD), Math.max(hostW - clampedW - PAD, PAD));
        // Flip below the shard when it sits near the top edge of the viewport.
        const flip = anchor.y - cardH - GAP < PAD;
        const y = flip ? anchor.y + GAP : anchor.y - cardH - GAP;
        el.style.left = `${Math.round(x)}px`;
        el.style.top = `${Math.round(Math.max(y, PAD))}px`;
        el.style.visibility = anchor.onScreen ? "visible" : "hidden";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selected]);
  useEffect(() => {
    if (!scrubBodyRef.current || !scrubIso) return;
    gsap.fromTo(
      scrubBodyRef.current,
      { autoAlpha: 0.4 },
      { autoAlpha: 1, duration: 0.28, ease: "power2.out" }
    );
  }, [scrubIso]);

  const summary = useMemo(
    () => (data ? buildStatusSummary(data) : null),
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

  const onApplyCatchUp = () => {
    if (!selected?.catchUpPlan) return;
    setRecoveryOpen(true);
    const { daysRecovered, daysLost } = selected.catchUpPlan;
    setStatus(
      `Recovering ${daysRecovered} of ${daysLost} days at ${selected.taskNameEn}…`
    );
    controllerRef.current?.applyCatchUpPlan(selected.id);
  };

  if (error) {
    return (
      <div className={styles.root}>
        <div className={styles.error}>Failed to load navigator data: {error}</div>
      </div>
    );
  }

  if (!data || !summary || !scrub || !timelineEffective) {
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
  const hasCatchUp = Boolean(
    selected?.catchUpPlan && selected.catchUpPlan.daysRecovered > 0
  );
  const effectiveDaysBehind = activeDaysBehind ?? summary.daysBehind;

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

  const slipClass =
    effectiveDaysBehind == null
      ? ""
      : effectiveDaysBehind > 0
        ? styles.statWarn
        : effectiveDaysBehind < 0
          ? styles.statGood
          : styles.statNeutral;
  const scrubSlipClass =
    scrub.daysBehind > 0
      ? styles.statWarn
      : scrub.daysBehind < 0
        ? styles.statGood
        : styles.statNeutral;

  return (
    <div className={styles.root}>
      <header className={`${styles.chromePanel} ${styles.statusBar}`}>
        <div className={styles.statusLead}>
          <p className={styles.kicker}>Schedule status · as-of {summary.asOf ?? "—"}</p>
          <h2 className={styles.projectName}>{summary.projectName}</h2>
        </div>
        <dl className={styles.statGrid}>
          <div className={styles.stat}>
            <dt>
              Schedule
              <ProvenanceBadge tag={summary.daysBehindProvenance} compact />
            </dt>
            <dd className={slipClass}>
              {formatSlip(effectiveDaysBehind)}
              <span className={styles.statHint}>
                projected {formatDay(effectiveProjectedEnd)}
              </span>
            </dd>
          </div>
          <div className={styles.stat}>
            <dt>% complete</dt>
            <dd className={styles.statMuted}>Unavailable</dd>
          </div>
          <div className={styles.stat}>
            <dt>Next milestone</dt>
            <dd>
              {summary.nextMilestone?.taskNameEn ?? "—"}
              {summary.nextMilestone ? (
                <span className={styles.statHint}>
                  planned {summary.nextMilestone.plannedEnd}
                </span>
              ) : null}
            </dd>
          </div>
          <div className={styles.stat}>
            <dt>
              Worst delay
              <ProvenanceBadge tag="FORGED" compact />
            </dt>
            <dd className={summary.worstUnresolvedDelay ? styles.statWarn : ""}>
              {summary.worstUnresolvedDelay
                ? `${summary.worstUnresolvedDelay.taskNameEn} · +${summary.worstUnresolvedDelay.localDelayDays}d`
                : "None"}
            </dd>
          </div>
        </dl>
      </header>

      <section
        className={
          scrub.isProjectedZone
            ? `${styles.chromePanel} ${styles.scrubBar} ${styles.scrubBarProjected}`
            : `${styles.chromePanel} ${styles.scrubBar}`
        }
        aria-label="Time-state inspection"
      >
        <p
          className={
            scrub.isProjectedZone
              ? styles.scrubProjectedBanner
              : `${styles.scrubProjectedBanner} ${styles.scrubProjectedBannerHidden}`
          }
          role="status"
          aria-hidden={!scrub.isProjectedZone}
        >
          Projected — not yet actual
        </p>
        <div className={styles.scrubBody} ref={scrubBodyRef}>
          <div className={styles.statusLead}>
            <p className={styles.kicker}>
              Inspecting · {formatScrubDay(scrub.scrubIso)}
            </p>
            <p className={styles.scrubLead}>
              State as of playhead
              {scrub.scrubIso === scrub.todayIso ? " (today)" : ""}
            </p>
          </div>
          <dl
            className={
              scrub.isProjectedZone
                ? `${styles.scrubStatGrid} ${styles.scrubStatGridProjected}`
                : styles.scrubStatGrid
            }
          >
            <div className={styles.stat}>
              <dt>
                Schedule
                <ProvenanceBadge tag={scrub.daysBehindProvenance} compact />
              </dt>
              <dd className={scrubSlipClass}>{formatSlip(scrub.daysBehind)}</dd>
            </div>
            <div className={styles.stat}>
              <dt>Complete</dt>
              <dd>
                {scrub.complete.length}
                <span className={styles.statHint}>
                  {scrub.complete.length === 0
                    ? "None finished yet"
                    : scrub.complete
                        .slice(-2)
                        .map((w) => w.taskNameEn)
                        .join(" · ")}
                </span>
              </dd>
            </div>
            <div className={styles.stat}>
              <dt>Pending</dt>
              <dd>
                {scrub.pending.length}
                <span className={styles.statHint}>
                  {scrub.pending[0]
                    ? `Next · ${scrub.pending[0].taskNameEn}`
                    : "All complete"}
                </span>
              </dd>
            </div>
            <div className={styles.stat}>
              <dt>
                Delays known
                <ProvenanceBadge tag="FORGED" compact />
              </dt>
              <dd className={scrub.worstDelay ? styles.statWarn : ""}>
                {scrub.delaysKnown.length === 0
                  ? "None"
                  : scrub.worstDelay
                    ? `${scrub.delaysKnown.length} · worst ${scrub.worstDelay.taskNameEn} +${scrub.worstDelay.localDelayDays}d`
                    : String(scrub.delaysKnown.length)}
              </dd>
            </div>
          </dl>
          {scrub.delaysKnown.length > 0 && (
            <ul className={styles.scrubDelayList}>
              {[...scrub.delaysKnown]
                .sort((a, b) => b.localDelayDays - a.localDelayDays)
                .map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      className={styles.scrubDelayBtn}
                      onClick={() => {
                        setSelected(w);
                        setClusterItems([]);
                        setRecoveryOpen(false);
                        setStatus("Delay detail open");
                      }}
                    >
                      <span>+{w.localDelayDays}d</span>
                      <span>{w.taskNameEn}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>

      <div className={styles.stage}>
        <div className={styles.viewportColumn}>
          <div className={styles.viewport} ref={hostRef}>
          <canvas ref={canvasRef} className={styles.canvas} />
          <div
            ref={axisOverlayRef}
            className={styles.axisOverlay}
            aria-hidden
          />

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
            <p>
              {data.waypoints.length} waypoints · {shardTotal} delays ·{" "}
              {clusterTotal} clusters
            </p>
          </div>

          {selected && (
            <aside className={styles.card} aria-live="polite" ref={cardRef}>
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
                  Time lost
                  <ProvenanceBadge tag={timeLostTag} compact />
                </p>
                <p className={styles.fieldBody}>
                  <strong>+{selected.localDelayDays} days</strong>
                  {" · "}
                  source <code>{selected.deviationDaysSource}</code>
                </p>
              </div>

              <div className={styles.field}>
                <p className={styles.fieldLabel}>
                  Reason
                  <ProvenanceBadge tag="FORGED" compact />
                </p>
                <p className={styles.fieldBody}>
                  {selected.delayReason ??
                    "No delay reason recorded for this waypoint."}
                </p>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={onApplyCatchUp}
                  disabled={!hasCatchUp}
                  title={
                    hasCatchUp
                      ? undefined
                      : "No catch-up plan on this delay (full residual stays on the cascade)"
                  }
                >
                  {hasCatchUp
                    ? `Apply catch-up (−${selected!.catchUpPlan!.daysRecovered}d)`
                    : "No catch-up plan"}
                </button>
              </div>

              {recoveryOpen && selected.catchUpPlan && (
                <div className={styles.recovery}>
                  <p className={styles.fieldLabel}>
                    Recovery
                    <ProvenanceBadge tag="FORGED" compact />
                  </p>
                  <p>{selected.catchUpPlan.summary}</p>
                  <p className={styles.placeholderNote}>
                    Partial correction only: {selected.catchUpPlan.daysRecovered} of{" "}
                    {selected.catchUpPlan.daysLost} days recovered (
                    {Math.round(
                      (selected.catchUpPlan.daysRecovered /
                        Math.max(selected.catchUpPlan.daysLost, 1)) *
                        100
                    )}
                    % of this local gap). Other delays keep their own residual.
                  </p>
                </div>
              )}
            </aside>
          )}
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
                    setClusterItems([]);
                    setRecoveryOpen(false);
                    controllerRef.current?.setScrubIso(m.waypoint.plannedEnd);
                  }}
                  aria-label={`Delay: ${m.waypoint.taskNameEn}, +${m.waypoint.localDelayDays} days`}
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

      <aside className={styles.legendPanel} aria-label="Scene legend">
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
              <i className={styles.swatchToday} /> Today
            </li>
            <li>
              <i className={styles.swatchShard} /> Delay shard
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
