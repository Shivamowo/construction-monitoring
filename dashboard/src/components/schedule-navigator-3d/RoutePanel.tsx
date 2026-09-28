"use client";

import { useMemo } from "react";
import type { NavigatorWaypoint, RecoveryOffer } from "@/lib/schedule-navigator/aggregate";
import { availableOffers, routeImpact } from "@/lib/schedule-navigator/routes";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import styles from "./ScheduleNavigator3D.module.css";

interface RoutePanelProps {
  offers: RecoveryOffer[];
  /** Chain of taken offer ids, in commit order. */
  takenIds: string[];
  waypoints: NavigatorWaypoint[];
  /** Projected finish on the route currently taken, and days past the plan. */
  projectedEnd: string;
  daysBehind: number;
  selected: RecoveryOffer | null;
  /** Offer whose take is in flight (path still morphing). */
  pendingId: string | null;
  recommendedId: string | null;
  onSelect: (offer: RecoveryOffer) => void;
  onBack: () => void;
  onTake: (offer: RecoveryOffer) => void;
  /** Undo a taken route and everything taken after it. */
  onUndo: (offerId: string) => void;
}

function formatDay(iso: string): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function signedDays(days: number): string {
  if (days === 0) return "±0d";
  return days < 0 ? `−${-days}d` : `+${days}d`;
}

/**
 * Right-hand column's route view. Resting: the route you're on (finish,
 * chain taken, routes on offer from here). With a route selected: that
 * route's full detail in place of the resting view, with one way back.
 *
 * Provenance: a route's summary, cost and claimed days are REAL (the
 * project's own recovery-plan.json) or FORGED (template) as tagged; what it
 * does to the schedule — finish change, tasks revised — is DERIVED by the
 * CPM engine, never the plan's own claim.
 */
export function RoutePanel(props: RoutePanelProps) {
  const {
    offers,
    takenIds,
    waypoints,
    projectedEnd,
    daysBehind,
    selected,
    pendingId,
    recommendedId,
    onSelect,
    onBack,
    onTake,
    onUndo,
  } = props;

  const onOffer = useMemo(() => availableOffers(offers, takenIds), [offers, takenIds]);
  const byId = useMemo(() => new Map(offers.map((o) => [o.id, o])), [offers]);
  const waypointName = (id: string) => {
    const w = waypoints.find((x) => x.id === id);
    return w ? w.taskNameEn || w.taskName : id;
  };

  if (selected) {
    const impact = routeImpact(waypoints, offers, takenIds, selected);
    const taken = takenIds.includes(selected.id);
    const pending = pendingId === selected.id;
    const parent = selected.parentId ? byId.get(selected.parentId) : undefined;
    const costs = selected.resourceCost
      .split(/,\s*/)
      .map((c) => c.trim())
      .filter(Boolean);
    return (
      <section className={styles.routePanel} aria-label="Recovery route detail" aria-live="polite">
        <button type="button" className={styles.routeBack} onClick={onBack}>
          ← Back to your route
        </button>
        <p className={styles.routeKicker}>
          Alternate route{selected.depth > 1 ? ` · level ${selected.depth}` : ""}
          <ProvenanceBadge tag={selected.provenance} compact />
        </p>
        <h3 className={styles.routeTitle}>{selected.taskName}</h3>
        <p className={styles.routeMeta}>
          {selected.mode === "claw-back"
            ? `Branches at the ${waypointName(selected.waypointId)} delay`
            : `Branches where ${waypointName(selected.waypointId)} starts`}
          {parent ? ` · only on offer because you took ${parent.taskName}` : ""}
        </p>

        <div className={styles.routeFigures}>
          <div className={styles.routeFigure}>
            <span className={styles.routeFigureLabel}>
              Projected finish <ProvenanceBadge tag="DERIVED" compact />
            </span>
            <span className={styles.routeFigureValue}>
              {formatDay(impact.finishBefore)} → {formatDay(impact.finishAfter)}
            </span>
            <span
              className={impact.finishDeltaDays < 0 ? styles.routeDeltaGood : styles.routeDeltaFlat}
            >
              {signedDays(impact.finishDeltaDays)} on the finish
            </span>
          </div>
          <div className={styles.routeFigure}>
            <span className={styles.routeFigureLabel}>
              Plan claims <ProvenanceBadge tag={selected.provenance} compact />
            </span>
            <span className={styles.routeFigureValue}>−{selected.daysRecovered}d</span>
            <span className={styles.routeFigureNote}>
              {selected.mode === "claw-back"
                ? `of ${selected.daysLost ?? "?"}d lost at ${waypointName(selected.waypointId)}`
                : `off ${selected.taskName}'s duration`}
            </span>
          </div>
        </div>
        {impact.finishDeltaDays === 0 ? (
          <p className={styles.routeNote}>
            The finish doesn&apos;t move: the tasks this route pulls in are not the ones setting
            the finish on the route you&apos;re on.
          </p>
        ) : -impact.finishDeltaDays < selected.daysRecovered ? (
          <p className={styles.routeNote}>
            Only {-impact.finishDeltaDays} of the {selected.daysRecovered} days reach the finish;
            the rest are absorbed downstream (float, or work that can&apos;t start before its
            planned date).
          </p>
        ) : null}
        {recommendedId === selected.id && !taken ? (
          <p className={styles.routeNote}>
            Computed suggestion <ProvenanceBadge tag="DERIVED" compact /> best days-recovered to
            cost ratio of the routes on offer.
          </p>
        ) : null}

        <h4 className={styles.routeSubhead}>What it does</h4>
        <p className={styles.routeBody}>{selected.summary}</p>

        <h4 className={styles.routeSubhead}>What it costs</h4>
        <ul className={styles.routeCosts}>
          {costs.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>

        <h4 className={styles.routeSubhead}>
          Tasks it moves <ProvenanceBadge tag="DERIVED" compact />
        </h4>
        {impact.revised.length ? (
          <table className={styles.routeTable}>
            <tbody>
              {impact.revised.map((r) => (
                <tr key={r.waypointId}>
                  <th scope="row">{r.name}</th>
                  <td>
                    {formatDay(r.before).replace(/ \d{4}$/, "")} → {formatDay(r.after).replace(/ \d{4}$/, "")}
                  </td>
                  <td>{signedDays(r.deltaDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.routeBody}>No projected dates move.</p>
        )}

        <div className={styles.routeActions}>
          {taken ? (
            <>
              <span className={styles.routeTaken}>Route taken ✓</span>
              <button type="button" className={styles.routeUndo} onClick={() => onUndo(selected.id)}>
                Undo this route and everything after it
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.routeTake}
              disabled={pending || pendingId !== null}
              onClick={() => onTake(selected)}
            >
              {pending ? "Taking route…" : `Take this route (${signedDays(impact.finishDeltaDays)} on finish)`}
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.routePanel} aria-label="Your route">
      <p className={styles.alertsTitle}>
        Your route <span className={styles.alertsTag}>Derived</span>
      </p>
      <p className={styles.routeFinish}>
        <span className={styles.routeFigureLabel}>Projected finish</span>
        <span className={styles.routeFinishValue}>{formatDay(projectedEnd)}</span>
        <span className={daysBehind > 0 ? styles.alertDaysProjected : styles.alertOnPlan}>
          {daysBehind > 0 ? `+${daysBehind}d vs plan` : "On plan"}
        </span>
      </p>

      {takenIds.length > 0 ? (
        <>
          <h4 className={styles.routeSubhead}>Routes taken</h4>
          <ol className={styles.routeChain}>
            {takenIds.map((id) => {
              const o = byId.get(id);
              if (!o) return null;
              return (
                <li key={id}>
                  <button type="button" className={styles.routeChainName} onClick={() => onSelect(o)}>
                    {o.taskName}
                  </button>
                  <button
                    type="button"
                    className={styles.routeUndoSmall}
                    onClick={() => onUndo(id)}
                    disabled={pendingId !== null}
                    aria-label={`Undo ${o.taskName} and everything after it`}
                  >
                    Undo
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}

      <h4 className={styles.routeSubhead}>Routes on offer</h4>
      {onOffer.length ? (
        <ul className={styles.routeOffers}>
          {onOffer.map((o) => {
            const delta = routeImpact(waypoints, offers, takenIds, o).finishDeltaDays;
            return (
              <li key={o.id}>
                <button type="button" className={styles.alertRow} onClick={() => onSelect(o)}>
                  <span className={styles.alertHead}>
                    <span className={styles.alertName}>{o.taskName}</span>
                    <span className={delta < 0 ? styles.routeDeltaGood : styles.routeDeltaFlat}>
                      {signedDays(delta)}
                    </span>
                  </span>
                  <span className={styles.alertMeta}>
                    {o.depth > 1 ? `Level ${o.depth} · ` : ""}
                    {o.resourceCost.split(/,\s*/)[0]}
                    {recommendedId === o.id ? " · suggested" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.routeBody}>
          {offers.length ? "No further routes on offer from here." : "This schedule ships no recovery routes."}
        </p>
      )}
    </section>
  );
}
