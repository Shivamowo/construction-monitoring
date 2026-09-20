/**
 * Verification harness: runs the SAME aggregation the API route runs, for the
 * three substation snapshots, and prints the fields that must differ between
 * them. Temporary check script — not part of the build pipeline.
 */
import fs from "node:fs";
import path from "node:path";
import { buildScheduleNavigatorPayload } from "../../dashboard/src/lib/schedule-navigator/aggregate";
import { DATA } from "./lib/paths";

for (const id of ["substation-t0", "substation-t1", "substation-t2"]) {
  const b = JSON.parse(fs.readFileSync(path.join(DATA, "projects", id, "data.json"), "utf8"));
  const p = buildScheduleNavigatorPayload(
    b.plannedSchedule, b.fusionOutputs, b.asBuiltDeviations, b.projectMetadata, b.milestones ?? []
  );
  const last = p.waypoints[p.waypoints.length - 1];
  const delayed = p.waypoints.filter((w: any) => w.localDelayDays > 0);
  console.log(`===== ${id} =====`);
  console.log(`  project:          ${p.projectName ?? b.projectMetadata.projectName}`);
  console.log(`  timeline.start:   ${p.timeline.start}`);
  console.log(`  timeline.asOf:    ${p.timeline.asOf}   (statusDate in file: ${b.projectMetadata.statusDate ?? "none"})`);
  console.log(`  planned end:      ${p.timeline.end}`);
  console.log(`  projectedEnd:     ${p.timeline.projectedEnd}`);
  console.log(`  waypoints:        ${p.waypoints.length}`);
  console.log(`  delayed wps:      ${delayed.length}  ${delayed.map((w: any) => `${w.taskName}(+${w.localDelayDays}d)`).join(", ") || "(none)"}`);
  console.log(`  total cascade:    ${last.cascadeShiftAfter ?? last.cascadeShiftBefore}d`);
  console.log(`  milestoneAlerts:  ${(p.milestoneAlerts ?? []).length}`);
  for (const a of p.milestoneAlerts ?? []) {
    console.log(`     - ${a.milestoneName}: ${a.status ?? ""} ${a.delayDays}d` +
      (a.rootCause?.length ? ` | root cause: ${a.rootCause.map((r: any) => `${r.taskName} (${r.reason})`).join("; ")}` : ""));
  }
  console.log("");
}
