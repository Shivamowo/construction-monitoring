"use client";

import { useState } from "react";
import type { MilestoneAlert } from "@/lib/schedule-navigator/aggregate";
import styles from "./ScheduleNavigator3D.module.css";

interface MilestoneAlertsPanelProps {
  alerts: MilestoneAlert[] | undefined;
  onFocus: (alert: MilestoneAlert) => void;
}

function formatShort(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Milestone-level delay alerts — the list view of what the red milestone
 * bands show in the scene. Every figure here is DERIVED (see aggregate.ts
 * computeMilestoneAlerts): delay is the worst member-task slip, root cause
 * names the critical-path task(s) that missed their dates, never a
 * narrative reason. Hidden entirely until some milestone is actually late,
 * same as the planned-reference line.
 */
export function MilestoneAlertsPanel({ alerts, onFocus }: MilestoneAlertsPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  if (!alerts || !alerts.some((a) => a.delayDays > 0)) return null;

  return (
    <section className={styles.alertsSection} aria-label="Milestone alerts">
      <p className={styles.alertsTitle}>
        Milestone alerts <span className={styles.alertsTag}>Derived</span>
      </p>
      <ul className={styles.alertsList}>
        {alerts.map((alert) => {
          const late = alert.delayDays > 0;
          const causes = alert.rootCause ?? [];
          return (
            <li key={alert.milestoneId}>
              <button
                type="button"
                className={`${styles.alertRow} ${late ? styles.alertRowLate : ""}`}
                aria-pressed={activeId === alert.milestoneId}
                onClick={() => {
                  setActiveId(alert.milestoneId);
                  onFocus(alert);
                }}
                title="Focus the camera on this milestone's span"
              >
                <span className={styles.alertHead}>
                  <span className={styles.alertName}>{alert.milestoneName}</span>
                  <span className={late ? styles.alertDays : styles.alertOnPlan}>
                    {late ? `+${alert.delayDays}d` : "On plan"}
                  </span>
                </span>
                <span className={styles.alertMeta}>
                  {formatShort(alert.plannedStart)} – {formatShort(alert.plannedEnd)}
                  {" · "}
                  {alert.isCriticalPath
                    ? "Critical path"
                    : alert.totalSlackDays != null
                      ? `${alert.totalSlackDays}d float`
                      : "Off critical path"}
                </span>
                {late && causes.length > 0 ? (
                  <span className={styles.alertCauses}>
                    <span className={styles.alertCauseLabel}>Root cause</span>
                    {causes.map((c) => (
                      <span key={String(c.taskId)} className={styles.alertCause}>
                        <strong>{c.taskName}</strong> — {c.reason}
                      </span>
                    ))}
                  </span>
                ) : null}
                {/* Not late yet: one line naming the zero-float tasks with no
                    buffer, so the list stays scannable next to the late ones. */}
                {!late && causes.length > 0 ? (
                  <span className={styles.alertMeta}>
                    At risk (zero float): {causes.map((c) => c.taskName).join(", ")}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
