/**
 * Stream 5: Fusion layer — DERIVED completionPct / deviationFlag + FORGED fields.
 */
import path from "node:path";
import { DATA, seededRandom, writeJson } from "./lib/paths";
import type { AsBuiltRow } from "./parse-schedule";
import type {
  BimComponent,
  DeviationFlag,
  FusionOutput,
  OnTimeStatus,
  ReviewStatus,
} from "../schema/types";

/**
 * completionPct formula (Step 5 — exact):
 *   For each componentId, let T = all schedule task rows for that component.
 *   Let referenceDate = the dataset's latest known planned date (max plannedEnd).
 *   Let done = count of tasks in T whose TaskFinish (plannedEnd) is <= referenceDate
 *             ("in the past" relative to the dataset's latest known date, inclusive).
 *   completionPct = (done / |T|) * 100
 *   (If |T| === 0, completionPct = 0.)
 *
 * Note: When referenceDate is the global max plannedEnd, nearly every task satisfies
 * plannedEnd <= referenceDate, so completionPct tends toward 100 for components
 * that appear in the schedule.
 */
export function buildFusion(
  components: BimComponent[],
  asBuiltRows: AsBuiltRow[],
  referenceDate: string
): FusionOutput[] {
  const byComp = new Map<string, AsBuiltRow[]>();
  for (const row of asBuiltRows) {
    const list = byComp.get(row.componentId) ?? [];
    list.push(row);
    byComp.set(row.componentId, list);
  }

  const outputs: FusionOutput[] = [];

  for (const comp of components) {
    const rows = byComp.get(comp.componentId) ?? [];
    const rand = seededRandom(`fusion:${comp.componentId}`);

    let completionPct = 0;
    if (rows.length > 0) {
      const done = rows.filter((r) => r.plannedEnd != null && r.plannedEnd <= referenceDate).length;
      completionPct = (done / rows.length) * 100;
    }
    completionPct = Math.round(completionPct * 10) / 10;

    // Aggregate onTimeStatus for the component (worst wins)
    let status: OnTimeStatus = "unknown";
    for (const r of rows) {
      if (r.onTimeStatus === "too_late") {
        status = "too_late";
        break;
      }
      if (r.onTimeStatus === "on_time") status = "on_time";
    }

    let deviationFlag: DeviationFlag;
    if (rows.length === 0) {
      deviationFlag = "not_scheduled";
    } else if (status === "too_late") {
      deviationFlag = "behind";
    } else if (status === "on_time") {
      deviationFlag = "on_time";
    } else {
      // unknown → on_time unless tasks incomplete past planned end
      const overdueIncomplete = rows.some(
        (r) =>
          r.onTimeStatus === "unknown" &&
          r.plannedEnd != null &&
          r.plannedEnd < referenceDate &&
          // treat unknown past end as incomplete
          true
      );
      // If all tasks observed-complete ratio is low and past end → behind
      deviationFlag =
        overdueIncomplete && completionPct < 100 ? "behind" : "on_time";
    }

    // FORGED confidenceWeightedScore — lower for sparse/incomplete history
    const taskDensity = Math.min(1, rows.length / 5);
    const completeness = completionPct / 100;
    let confidenceWeightedScore =
      0.25 * taskDensity + 0.45 * completeness + 0.2 * (status === "unknown" ? 0.4 : 0.85);
    if (status === "too_late") confidenceWeightedScore *= 0.85;
    confidenceWeightedScore = Math.max(0.05, Math.min(0.98, confidenceWeightedScore + (rand() - 0.5) * 0.08));
    confidenceWeightedScore = Math.round(confidenceWeightedScore * 1000) / 1000;

    // FORGED reviewStatus — consistent with completionPct
    let reviewStatus: ReviewStatus;
    if (completionPct === 0) {
      reviewStatus = rand() < 0.7 ? "pending" : "needs_review";
    } else if (status === "too_late" || deviationFlag === "behind") {
      reviewStatus = rand() < 0.6 ? "needs_review" : "pending";
    } else if (completionPct >= 90 && confidenceWeightedScore >= 0.6) {
      reviewStatus = rand() < 0.75 ? "approved" : "pending";
    } else if (completionPct < 40) {
      reviewStatus = rand() < 0.5 ? "pending" : "needs_review";
    } else {
      const roll = rand();
      reviewStatus =
        roll < 0.45 ? "pending" : roll < 0.75 ? "needs_review" : roll < 0.9 ? "approved" : "rejected";
    }
    // Hard constraint: never approved at 0%
    if (completionPct === 0 && reviewStatus === "approved") reviewStatus = "pending";

    const lastUpdated = `${referenceDate}T${String(10 + Math.floor(rand() * 8)).padStart(2, "0")}:${String(
      Math.floor(rand() * 60)
    ).padStart(2, "0")}:00Z`;

    outputs.push({
      componentId: comp.componentId,
      completionPct,
      confidenceWeightedScore,
      deviationFlag,
      lastUpdated,
      reviewStatus,
      _provenance: {
        componentId: "REAL",
        completionPct: "DERIVED",
        confidenceWeightedScore: "FORGED",
        deviationFlag: "DERIVED",
        lastUpdated: "FORGED",
        reviewStatus: "FORGED",
        unscheduledFallback: "Components with no schedule history default to completionPct: 0% and deviationFlag: 'not_scheduled' because no construction tasks were planned or tracked for these components.",
      },
    });
  }

  writeJson(path.join(DATA, "fusion.json"), outputs);
  return outputs;
}
