/**
 * The onboarded projects, in the order they should be offered.
 *
 * Single source of truth for both the starting page (ProjectIndex) and the
 * in-header phase dropdown (PhaseSwitcher) — they drifted apart the moment
 * there were two copies, so there is one.
 */
export interface PhaseEntry {
  stage: string;
  project: string;
  title: string;
  blurb: string;
  facts: ReadonlyArray<readonly [string, string]>;
}

export const PHASES: readonly PhaseEntry[] = [
  {
    stage: "Phase 1",
    project: "substation-t0",
    title: "Plan as Issued",
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
    blurb:
      "Same history — a recovery plan cannot rewrite what happened. The forward schedule is re-issued and the finish pulls back in.",
    facts: [
      ["Status date", "10 Nov 2026"],
      ["Days recovered", "7"],
      ["Projected finish", "3 Feb 2027"],
    ],
  },
] as const;

export const SUPPORTING = [
  { project: "schependomlaan", label: "Schependomlaan", note: "BIM + point-cloud source" },
  { project: "mspdi-sample", label: "MSPDI Sample", note: "original baseline import" },
  { project: "mspdi-demo", label: "MSPDI Demo", note: "superseded by Phase 2" },
  { project: "mspdi-demo-recovered", label: "MSPDI Demo · Recovered", note: "superseded by Phase 3" },
] as const;
