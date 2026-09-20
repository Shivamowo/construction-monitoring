/**
 * SKELETON — recovery-plan ingestion. NOT implemented against a real
 * format yet: blocked on an actual sample export from the external
 * recovery-plan tool (stage 3 of the navigation workflow — see
 * `Claude outputs/milestone-assessment-and-root-cause-brief.md` for the
 * stage numbering). Nothing here should be treated as final; it exists so
 * the moment a real sample export shows up, there is a fast first step
 * instead of a blank page.
 *
 * What to do when a real sample export lands:
 *   1. Run: tsx ingest-recovery-plan.ts --inspect <path-to-raw-export.json>
 *      Prints the file's actual top-level shape — do NOT assume anything
 *      about the format before seeing this output.
 *   2. Update `RecoveryPlan`/`RecoveryPlanRevisedTask` in
 *      shared/schema/types.ts to match the REAL fields seen — delete
 *      whatever placeholder fields don't actually appear, add whatever
 *      real ones do. Those two interfaces are explicitly marked SKELETON
 *      for exactly this reason.
 *   3. Write the real translation using the SAME dot-notation
 *      FieldMapping/ConverterType pattern already in mapping-engine.ts —
 *      this is not a new pipeline, it's the existing one pointed at a new
 *      sourceFormat. Add `"recovery-plan-json"` to raw-parsers.ts'
 *      SourceFormat union (it can likely reuse the existing `parseJson`
 *      passthrough parser as-is — a raw JSON export needs no new parser
 *      code, only a new mapping-config).
 *   4. Replace the body of `applyRecoveryPlan()` below with the real
 *      logic: read shared/data/projects/<id>/recovery-plan-raw.json,
 *      map it to a RecoveryPlan, then splice `revisedTasks` onto that
 *      project's plannedSchedule (new planned dates + critical-path/slack
 *      recompute) and re-run build-project.ts, OR extend build-project.ts
 *      itself to pick up a recovery-plan file when present. Don't decide
 *      which of those two shapes is right until the real field list is in
 *      hand — the "watch execution + re-project" stage-4 behavior depends
 *      on how the export represents *changes* (a full revised schedule vs.
 *      a diff), which isn't knowable yet.
 *
 * Run: tsx ingest-recovery-plan.ts --inspect <path>
 */
import fs from "node:fs";
import type { RecoveryPlan } from "../schema/types";

/** Prints an unknown JSON file's top-level shape without assuming anything about it. */
function describe(value: unknown): string {
  if (Array.isArray(value)) {
    return `array(${value.length})${value.length ? ` of ${describe(value[0])}` : ""}`;
  }
  if (value && typeof value === "object") {
    return `object{${Object.keys(value).join(", ")}}`;
  }
  return typeof value;
}

function inspect(filePath: string): void {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  console.log(`Top-level shape of ${filePath}:`);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      console.log(`  ${key}: ${describe(value)}`);
    }
  } else {
    console.log(`  root: ${describe(raw)}`);
  }
}

/**
 * NOT IMPLEMENTED — placeholder signature only, so callers/imports have
 * something to point at. Throws until step 4 above is done for real.
 */
function applyRecoveryPlan(_projectId: string): RecoveryPlan {
  throw new Error(
    "Recovery-plan ingestion is not implemented yet — no real sample export has been seen. " +
      "Run with --inspect <path> once one is available."
  );
}

function main(): void {
  const [mode, filePath] = process.argv.slice(2);
  if (mode === "--inspect" && filePath) {
    inspect(filePath);
    return;
  }
  console.log("Recovery-plan ingestion is a skeleton — not implemented against a real format yet.");
  console.log("Usage: tsx ingest-recovery-plan.ts --inspect <path-to-raw-export.json>");
}

if (require.main === module) {
  main();
}

export { applyRecoveryPlan, inspect };
