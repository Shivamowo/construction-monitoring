/**
 * Scripted walkthrough of the three phases.
 *
 * Each step is a project plus what to say about it. Switching phase is a full
 * page navigation, so the tour's position lives in sessionStorage rather than
 * React state — it has to survive the load it causes. sessionStorage (not
 * local) so it dies with the tab and never greets someone unexpectedly.
 */
export interface TourStep {
  project: string;
  chapter: string;
  title: string;
  body: string;
  /** What to physically look at on this screen. */
  look: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    project: "substation-t0",
    chapter: "Phase 1 of 3",
    title: "The plan as issued",
    body:
      "A Microsoft Project export taken on the day the job starts — 1 Oct 2026. Nothing has been built yet, so there is no measured progress anywhere: this is purely the route the team committed to.",
    look:
      "Playhead sits at the far left. No delay markers, and the projected finish equals the planned finish: 29 Jan 2027.",
  },
  {
    project: "substation-t1",
    chapter: "Phase 2 of 3",
    title: "Six weeks in, and it has slipped",
    body:
      "A second export, taken 10 Nov 2026. The plan has not changed — what is new is what actually happened. Detailed Design finished six days late and it sits on the critical path, so the whole downstream cascade moves with it.",
    look:
      "The red sleeve over the start of the route is the Engineering milestone running late — delay shown at the level it is assessed, not as one isolated marker. The grey line running alongside is a recovery route on offer; it has not been taken yet.",
  },
  {
    project: "substation-t2",
    chapter: "Phase 3 of 3",
    title: "The recovery, applied",
    body:
      "A third export, same status date. The history is byte-identical — a recovery plan cannot rewrite what already happened. What changed is the forward plan: Site Clearance compressed, Cable Trenches overlapped with Foundations, and everything after it pulled in.",
    look:
      "Projected finish moves from 10 Feb 2027 to 3 Feb 2027 — seven days recovered. The superseded route stays drawn in grey above the one now taken.",
  },
] as const;

const KEY = "navigator-demo-tour-step";

export function getTourStep(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n < TOUR_STEPS.length ? n : null;
  } catch {
    // Private mode / blocked storage: the tour simply never starts.
    return null;
  }
}

export function setTourStep(step: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (step === null) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, String(step));
  } catch {
    /* ignore — see getTourStep */
  }
}

/** Begin at step 0 and navigate to its project. */
export function startTour(): void {
  setTourStep(0);
  window.location.href = `/?project=${TOUR_STEPS[0].project}`;
}

/** Advance; navigates when the next step is a different project. Ends the tour past the last step. */
export function advanceTour(current: number): void {
  const next = current + 1;
  if (next >= TOUR_STEPS.length) {
    setTourStep(null);
    window.location.href = "/";
    return;
  }
  setTourStep(next);
  window.location.href = `/?project=${TOUR_STEPS[next].project}`;
}

export function exitTour(): void {
  setTourStep(null);
}
