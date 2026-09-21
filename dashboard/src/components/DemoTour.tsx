"use client";

import { useEffect, useState } from "react";
import {
  TOUR_STEPS,
  advanceTour,
  exitTour,
  getTourStep,
  startTour,
} from "@/lib/demoTour";
import styles from "./DemoTour.module.css";

/**
 * Renders both the "Run demo" trigger and, when a tour is running, the
 * narration panel for the current step.
 *
 * Read on mount rather than during render: sessionStorage is not available
 * server-side, and rendering the panel during SSR would hydrate-mismatch.
 */
export function DemoTour() {
  const [step, setStep] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setStep(getTourStep());
    setReady(true);
  }, []);

  // Escape ends the tour — a demo that traps you is worse than no demo.
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        exitTour();
        setStep(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  if (!ready) return null;

  if (step === null) {
    return (
      <button type="button" className={styles.trigger} onClick={startTour}>
        Run demo
      </button>
    );
  }

  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => {
          exitTour();
          setStep(null);
        }}
      >
        End demo
      </button>

      <aside className={styles.panel} role="region" aria-label="Demo walkthrough">
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
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              exitTour();
              setStep(null);
            }}
          >
            Exit
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => advanceTour(step)}
          >
            {isLast ? "Finish" : "Next phase"}
          </button>
        </div>
      </aside>
    </>
  );
}
