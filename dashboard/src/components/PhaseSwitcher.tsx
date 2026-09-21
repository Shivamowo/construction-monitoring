"use client";

import { useEffect, useState } from "react";
import { PHASES, SUPPORTING } from "@/lib/projects";
import styles from "./PhaseSwitcher.module.css";

/**
 * Header dropdown for jumping between phases without going back to the
 * index. Reads the current project from the URL in an effect rather than
 * during render: `useSearchParams` would force a Suspense boundary on
 * everything the header wraps, and the value is only needed to preselect
 * the option, so a first paint with nothing selected is harmless.
 *
 * Navigates with a full location change on purpose — the 3D scene is built
 * once per mount from its payload, so switching projects is a remount
 * either way.
 */
export function PhaseSwitcher() {
  const [current, setCurrent] = useState("");

  useEffect(() => {
    setCurrent(new URLSearchParams(window.location.search).get("project") ?? "");
  }, []);

  return (
    <label className={styles.wrap}>
      <span className={styles.label}>Phase</span>
      <select
        className={styles.select}
        value={current}
        aria-label="Switch project phase"
        onChange={(event) => {
          const next = event.target.value;
          window.location.href = next
            ? `/?project=${encodeURIComponent(next)}`
            : "/";
        }}
      >
        <option value="">All phases — index</option>
        <optgroup label="Sample Substation Project">
          {PHASES.map((phase) => (
            <option key={phase.project} value={phase.project}>
              {phase.stage} · {phase.title}
            </option>
          ))}
        </optgroup>
        <optgroup label="Other projects">
          {SUPPORTING.map((item) => (
            <option key={item.project} value={item.project}>
              {item.label}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
