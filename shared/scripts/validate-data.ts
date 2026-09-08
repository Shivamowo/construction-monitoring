/**
 * Step 10: Validate shared/data JSON against schema.json + referential integrity.
 */
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { DATA, SCHEMA } from "./lib/paths";

interface Issue {
  level: "error" | "warn";
  message: string;
}

function loadJson(p: string): unknown {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  const issues: Issue[] = [];
  const schemaPath = path.join(SCHEMA, "schema.json");
  const schema = loadJson(schemaPath) as object;

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateRoot = ajv.compile(schema);

  const requiredFiles = [
    "components.json",
    "schedule.json",
    "deviation.json",
    "photos.json",
    "fusion.json",
    "safety.json",
    "metadata.json",
    "data.json",
    "data-generation-log.md",
  ];

  for (const f of requiredFiles) {
    const p = path.join(DATA, f);
    if (!fs.existsSync(p)) {
      issues.push({ level: "error", message: `Missing required file: ${f}` });
    }
  }

  if (issues.some((i) => i.level === "error" && i.message.startsWith("Missing"))) {
    printReport(issues, false);
    process.exit(1);
  }

  const components = loadJson(path.join(DATA, "components.json")) as Array<{
    componentId: string;
  }>;
  const schedule = loadJson(path.join(DATA, "schedule.json")) as Array<{
    componentId: string;
  }>;
  const deviations = loadJson(path.join(DATA, "deviation.json")) as Array<{
    componentId: string;
  }>;
  const photos = loadJson(path.join(DATA, "photos.json")) as Array<{
    componentId: string;
  }>;
  const fusion = loadJson(path.join(DATA, "fusion.json")) as Array<{
    componentId: string;
  }>;
  const safety = loadJson(path.join(DATA, "safety.json"));
  const metadata = loadJson(path.join(DATA, "metadata.json"));
  const data = loadJson(path.join(DATA, "data.json")) as Record<string, unknown>;

  // Validate full bundle against root schema
  if (!validateRoot(data)) {
    for (const err of validateRoot.errors ?? []) {
      issues.push({
        level: "error",
        message: `data.json schema: ${err.instancePath || "/"} ${err.message}`,
      });
    }
  } else {
    console.log("data.json: schema OK");
  }

  // Validate individual stream files by wrapping into minimal root objects
  // (items must match $defs shapes — validate via data.json arrays already;
  // also check required root metadata fields)
  if (typeof data.schemaVersion !== "string") {
    issues.push({ level: "error", message: "data.json missing schemaVersion" });
  }
  if (typeof data.generatedAt !== "string") {
    issues.push({ level: "error", message: "data.json missing generatedAt" });
  }

  // Spot-check array lengths match
  const checks: Array<[string, unknown, unknown]> = [
    ["bimComponents", components, data.bimComponents],
    ["plannedSchedule", schedule, data.plannedSchedule],
    ["asBuiltDeviations", deviations, data.asBuiltDeviations],
    ["siteEngineerPhotos", photos, data.siteEngineerPhotos],
    ["fusionOutputs", fusion, data.fusionOutputs],
    ["safetyDetections", safety, data.safetyDetections],
  ];
  for (const [name, fileVal, dataVal] of checks) {
    const a = Array.isArray(fileVal) ? fileVal.length : -1;
    const b = Array.isArray(dataVal) ? dataVal.length : -1;
    if (a !== b) {
      issues.push({
        level: "warn",
        message: `${name} length mismatch file=${a} data.json=${b}`,
      });
    }
  }

  // Referential integrity
  const idSet = new Set(components.map((c) => c.componentId));
  const checkRefs = (label: string, rows: Array<{ componentId: string }>) => {
    const orphans = new Set<string>();
    for (const r of rows) {
      if (!idSet.has(r.componentId)) orphans.add(r.componentId);
    }
    if (orphans.size) {
      issues.push({
        level: "error",
        message: `${label}: ${orphans.size} orphan componentId(s) e.g. ${[...orphans].slice(0, 5).join(", ")}`,
      });
    } else {
      console.log(`${label}: referential integrity OK (${rows.length} refs)`);
    }
  };

  checkRefs("schedule.json", schedule);
  checkRefs("deviation.json", deviations);
  checkRefs("photos.json", photos);
  checkRefs("fusion.json", fusion);

  // deviationDaysSource presence
  for (const d of deviations as Array<Record<string, unknown>>) {
    if (d.deviationDaysSource !== "derived" && d.deviationDaysSource !== "forged") {
      issues.push({
        level: "error",
        message: `deviation missing deviationDaysSource for ${d.componentId}`,
      });
      break;
    }
  }

  // schedule taskNameEn and weeklyIfcSnapshots presence
  for (const s of schedule as Array<Record<string, unknown>>) {
    if (typeof s.taskNameEn !== "string" || !s.taskNameEn) {
      issues.push({
        level: "error",
        message: `schedule row missing taskNameEn for task ${s.taskId}`,
      });
      break;
    }
    if (!Array.isArray(s.weeklyIfcSnapshots) || s.weeklyIfcSnapshots.length === 0) {
      issues.push({
        level: "error",
        message: `schedule row missing weeklyIfcSnapshots for task ${s.taskId}`,
      });
      break;
    }
  }

  // photos droneFootageRef presence
  for (const p of photos as Array<Record<string, unknown>>) {
    if (typeof p.droneFootageRef !== "string" || !p.droneFootageRef.startsWith("http")) {
      issues.push({
        level: "error",
        message: `photo record missing valid droneFootageRef for ${p.photoId}`,
      });
      break;
    }
  }

  // metadata milestoneMappingTable presence
  const metaObj = metadata as Record<string, unknown>;
  if (!Array.isArray(metaObj.milestoneMappingTable) || metaObj.milestoneMappingTable.length === 0) {
    issues.push({
      level: "error",
      message: "metadata.json missing milestoneMappingTable",
    });
  }

  const ok = !issues.some((i) => i.level === "error");
  printReport(issues, ok);
  process.exit(ok ? 0 : 1);
}

function printReport(issues: Issue[], ok: boolean) {
  console.log("\n=== VALIDATION REPORT ===");
  if (!issues.length) {
    console.log("PASS — no issues");
  } else {
    for (const i of issues) {
      console.log(`${i.level.toUpperCase()}: ${i.message}`);
    }
    console.log(ok ? "PASS (warnings only)" : "FAIL");
  }
  fs.writeFileSync(
    path.join(DATA, "_validation-report.json"),
    JSON.stringify({ ok, issues }, null, 2)
  );
}

main();
