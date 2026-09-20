import styles from "./ProjectIndex.module.css";

/**
 * Starting page. The Schedule Navigator answers "where is this project and
 * where is it going" for ONE snapshot at a time; this page is the way in,
 * and makes the three-phase story navigable rather than something you have
 * to know the URLs for.
 *
 * PHASES are the demo spine: one Sample Substation Project, three real MSPDI
 * exports taken at three points in its life. SUPPORTING are the other
 * onboarded projects, kept reachable but deliberately not competing with the
 * story above.
 */
const PHASES = [
  {
    stage: "Phase 1",
    project: "substation-t0",
    title: "Plan as Issued",
    statusDate: "1 Oct 2026",
    blurb:
      "The route before departure. Every task still ahead, critical path marked, nothing measured yet.",
    facts: [
      ["Status date", "Project start"],
      ["Measured delay", "None — not started"],
      ["Projected finish", "29 Jan 2027"],
    ],
  },
  {
    stage: "Phase 2",
    project: "substation-t1",
    title: "Status Update",
    statusDate: "10 Nov 2026",
    blurb:
      "Six weeks in. Detailed Design finished 6 days late and took the critical path with it; the recovery route is drawn alongside, not yet taken.",
    facts: [
      ["Status date", "10 Nov 2026"],
      ["Engineering milestone", "6 days behind"],
      ["Projected finish", "10 Feb 2027"],
    ],
  },
  {
    stage: "Phase 3",
    project: "substation-t2",
    title: "Recovery Re-issue",
    statusDate: "10 Nov 2026",
    blurb:
      "Same history — a recovery plan cannot rewrite what happened. The forward schedule is re-issued and the finish pulls back in.",
    facts: [
      ["Status date", "10 Nov 2026"],
      ["Days recovered", "7"],
      ["Projected finish", "3 Feb 2027"],
    ],
  },
] as const;

const SUPPORTING = [
  { project: "schependomlaan", label: "Schependomlaan", note: "BIM + point-cloud source" },
  { project: "mspdi-sample", label: "MSPDI Sample", note: "original baseline import" },
  { project: "mspdi-demo", label: "MSPDI Demo", note: "superseded by Phase 2" },
  { project: "mspdi-demo-recovered", label: "MSPDI Demo · Recovered", note: "superseded by Phase 3" },
] as const;

export function ProjectIndex() {
  return (
    <div className={styles.page}>
      <section className={styles.intro}>
        <p className={styles.kicker}>Sample Substation Project</p>
        <h2 className={styles.heading}>One project, three points in time.</h2>
        <p className={styles.lede}>
          Each phase below is a separate Microsoft Project export of the same
          schedule, ingested through the same pipeline. Open them in order to
          follow the project from plan, to slippage, to recovery.
        </p>
      </section>

      <ol className={styles.phaseGrid}>
        {PHASES.map((phase) => (
          <li key={phase.project}>
            <a className={styles.phaseCard} href={`/?project=${phase.project}`}>
              <span className={styles.stage}>{phase.stage}</span>
              <h3 className={styles.phaseTitle}>{phase.title}</h3>
              <p className={styles.blurb}>{phase.blurb}</p>
              <dl className={styles.facts}>
                {phase.facts.map(([label, value]) => (
                  <div key={label} className={styles.fact}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <span className={styles.cta}>Open navigator</span>
            </a>
          </li>
        ))}
      </ol>

      <section className={styles.supporting}>
        <h4 className={styles.supportingHeading}>Other onboarded projects</h4>
        <ul className={styles.supportingList}>
          {SUPPORTING.map((item) => (
            <li key={item.project}>
              <a href={`/?project=${item.project}`} className={styles.supportingLink}>
                <span className={styles.supportingLabel}>{item.label}</span>
                <span className={styles.supportingNote}>{item.note}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
