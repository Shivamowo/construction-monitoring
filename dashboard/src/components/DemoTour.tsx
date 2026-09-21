"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TOUR_STEPS,
  advanceTour,
  exitTour,
  getTourStep,
  startTour,
} from "@/lib/demoTour";
import styles from "./DemoTour.module.css";

/**
 * The tour has two pieces in two different places: the trigger lives in the
 * header, the narration panel flows inside the navigator's side column under
 * the legend. They are separate components rather than one fixed-position
 * overlay because the panel needs to take its natural height in that column —
 * a floating card had to guess at the space available and clipped its own
 * text when it guessed low.
 *
 * Both read the same sessionStorage key, so they need to hear about each
 * other's changes: a window event is enough, and keeps them from needing a
 * shared provider for one boolean.
 */
const CHANGE_EVENT = "navigator-demo-tour-change";

function useTourStep(): [number | null, (next: number | null) => void, boolean] {
  const [step, setStep] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setStep(getTourStep());
    setReady(true);
    const sync = () => setStep(getTourStep());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  const update = useCallback((next: number | null) => {
    if (next === null) exitTour();
    setStep(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [step, update, ready];
}

/** Header trigger: starts the tour, or ends one that is running. */
export function DemoTourButton() {
  const [step, update, ready] = useTourStep();
  if (!ready) return null;

  return step === null ? (
    <button type="button" className={styles.trigger} onClick={startTour}>
      Run demo
    </button>
  ) : (
    <button type="button" className={styles.trigger} onClick={() => update(null)}>
      End demo
    </button>
  );
}

/** Narration panel. Renders nothing unless a tour is running. */
export function DemoTourPanel() {
  const [step, update, ready] = useTourStep();

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") update(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, update]);

  if (!ready || step === null) return null;

  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <aside className={styles.panel} aria-label="Demo walkthrough">
      <div className={styles.progress}>
        {TOUR_STEPS.map((s, i) => (
          <span
            key={s.project}
            className={`${styles.pip} ${i === step ? styles.pipOn : ""} ${i < step ? styles.pipDone : ""}`}
          />
        ))}
      </div>

      <p className={styles.chapter}>{current.chapter}</p>
      <h2 className={styles.title}>{current.title}</h2>
      <p className={styles.body}>{current.body}</p>

      <p className={styles.look}>
        <span className={styles.lookLabel}>What to look at</span>
        {current.look}
      </p>

      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={() => update(null)}>
          Exit
        </button>
        <button type="button" className={styles.primary} onClick={() => advanceTour(step)}>
          {isLast ? "Finish" : "Next phase"}
        </button>
      </div>
    </aside>
  );
}
