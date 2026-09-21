import { PHASES, SUPPORTING } from "@/lib/projects";
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
