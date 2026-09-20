/**
 * Apply a RecoveryPlan (our own skeleton shape — see shared/schema/types.ts
 * and ingest-recovery-plan.ts's header) onto an already-built project's
 * data.json, writing the result as a NEW project id. This is step 4 of
 * ingest-recovery-plan.ts's plan, done now against a SELF-AUTHORED demo
 * recovery-plan.json (shared/data/projects/<id>/recovery-plan.json) — not
 * a real export from the external recovery-plan tool, which doesn't exist
 * yet. When that real export lands, this splice step is likely still the
 * right shape (revise a few task dates onto a copy of the schedule), but
 * confirm that once the real field list is known — don't assume.
 *
 * Only plannedStart/plannedEnd are revised. isCriticalPath/totalSlackDays/
 * predecessors are left as-is (a real recovery plan may also change these
 * via crew reallocation changing float; out of scope for this demo splice).
 * milestones/projectMetadata are copied unchanged — milestoneAlerts and the
 * cascade/forecast math are recomputed downstream in aggregate.ts from the
 * revised plannedSchedule at request time, same as any other project.
 *
 * Run: tsx apply-recovery-plan.ts <sourceProjectId> <newProjectId>
 */
import fs from "node:fs";
import path from "node:path";
import type { AsBuiltDeviation, FusionOutput, Milestone, PlannedTask, ProjectMetadata, RecoveryPlan } from "../schema/types";
import { DATA, writeJson } from "./lib/paths";

const PROJECTS_DIR = path.join(DATA, "projects");

interface ProjectBundle {
  plannedSchedule: PlannedTask[];
  fusionOutputs: FusionOutput[];
  asBuiltDeviations: AsBuiltDeviation[];
  projectMetadata: ProjectMetadata;
  milestones: Milestone[];
}

function applyRecoveryPlan(sourceProjectId: string, newProjectId: string): void {
  const sourcePath = path.join(PROJECTS_DIR, sourceProjectId, "data.json");
  const planPath = path.join(PROJECTS_DIR, sourceProjectId, "recovery-plan.json");
  if (!fs.existsSync(sourcePath)) throw new Error(`No data.json for "${sourceProjectId}" at ${sourcePath}`);
  if (!fs.existsSync(planPath)) throw new Error(`No recovery-plan.json for "${sourceProjectId}" at ${planPath}`);

  const bundle: ProjectBundle = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const plan: RecoveryPlan = JSON.parse(fs.readFileSync(planPath, "utf8"));

  const revisedById = new Map(plan.revisedTasks.map((t) => [String(t.taskId), t]));
  let revisedCount = 0;
  const plannedSchedule = bundle.plannedSchedule.map((task) => {
    const revision = revisedById.get(String(task.taskId));
    if (!revision) return task;
    revisedCount += 1;
    return {
      ...task,
      plannedStart: revision.newPlannedStart,
      plannedEnd: revision.newPlannedEnd,
      ...(revision.newIsCriticalPath !== undefined ? { isCriticalPath: revision.newIsCriticalPath } : {}),
      ...(revision.newTotalSlackDays !== undefined ? { totalSlackDays: revision.newTotalSlackDays } : {}),
    };
  });

  const outDir = path.join(PROJECTS_DIR, newProjectId);
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, "data.json"), {
    plannedSchedule,
    fusionOutputs: bundle.fusionOutputs,
    asBuiltDeviations: bundle.asBuiltDeviations,
    projectMetadata: bundle.projectMetadata,
    milestones: bundle.milestones,
    recoveryPlan: plan,
  });

  console.log(`Applied recovery plan "${plan.recoveryPlanId}" from ${sourceProjectId} -> ${newProjectId}`);
  console.log(`  revised tasks: ${revisedCount} of ${plan.revisedTasks.length} plan entries matched`);
  console.log(`  note: ${plan.note ?? "(none)"}`);
}

function main(): void {
  const [sourceProjectId, newProjectId] = process.argv.slice(2);
  if (!sourceProjectId || !newProjectId) {
    console.error("Usage: tsx apply-recovery-plan.ts <sourceProjectId> <newProjectId>");
    process.exit(1);
  }
  applyRecoveryPlan(sourceProjectId, newProjectId);
}

if (require.main === module) {
  main();
}

export { applyRecoveryPlan };
