"use client";

import type { Maneuver, ManeuverKind } from "@/lib/schedule-navigator/nextUp";
import styles from "./NextUpBanner.module.css";

/**
 * Satnav-style maneuver card: what you hit next from the current scrub
 * position, with a glance at the one after it. The 3D route shows the shape
 * of the schedule; this says what to expect, which otherwise means reading
 * dates off the axis.
 */
function Glyph({ kind }: { kind: ManeuverKind }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.1,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "milestone") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M12 3l2.6 5.6 6.1.8-4.4 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.3 9.4l6.1-.8z" />
      </svg>
    );
  }
  if (kind === "finish") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M5 21V4" />
        <path d="M5 5h13l-2.5 4L18 13H5z" />
      </svg>
    );
  }
  if (kind === "delay") {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    );
  }
  if (kind === "critical") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M12 3.5l8.5 15H3.5z" />
        <path d="M12 9.5v4" />
        <path d="M12 16.4h.01" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.2h.01" />
      <path d="M12 11.5v4.3" />
    </svg>
  );
}

function distance(daysAway: number): string {
  if (daysAway === 0) return "today";
  if (daysAway === 1) return "1 day";
  if (daysAway < 21) return `${daysAway} days`;
  const weeks = Math.round(daysAway / 7);
  return `${weeks} wks`;
}

export function NextUpBanner({ maneuvers }: { maneuvers: Maneuver[] }) {
  const [next, then] = maneuvers;
  if (!next) return null;

  return (
    <div className={styles.wrap} aria-live="polite">
      <div className={`${styles.card} ${styles[next.kind]}`}>
        <span className={styles.glyph}>
          <Glyph kind={next.kind} />
        </span>
        <span className={styles.distance}>{distance(next.daysAway)}</span>
        <span className={styles.body}>
          <span className={styles.label}>{next.label}</span>
          <span className={styles.detail}>{next.detail}</span>
        </span>
      </div>
      {then ? (
        <div className={styles.then}>
          <span className={styles.thenWord}>Then</span>
          <span className={`${styles.thenGlyph} ${styles[then.kind]}`}>
            <Glyph kind={then.kind} />
          </span>
          <span className={styles.thenLabel}>{then.label}</span>
          <span className={styles.thenDistance}>· {distance(then.daysAway)}</span>
        </div>
      ) : null}
    </div>
  );
}
