/**
 * Build script: raw file -> raw-parser -> mapping-engine -> data.json for
 * ONE project. Run once per onboarded project (or whenever its raw source
 * changes) — route.ts reads the pre-built data.json at request time, same
 * as today; this script never runs in the request path.
 *
 * Onboarding a new project going forward:
 *   1. drop the raw file(s) in shared/data/projects/<newId>/raw/
 *   2. write shared/data/projects/<newId>/mapping-config.json
 *   3. tsx build-project.ts <newId>
 * Zero navigator/rendering code touched.
 *
 * Run: tsx build-project.ts <projectId>
 */
import fs from "node:fs";
import path from "node:path";
import type {
  AsBuiltDeviation,
  FusionOutput,
  RecoveryPlan,
} from "../schema/types";
import { runMappingEngine, type MappingConfig } from "./mapping-engine";
import { parseRawFile, type SourceFormat } from "./raw-parsers";
import { DATA, writeJson } from "./lib/paths";

const PROJECTS_DIR = path.join(DATA, "projects");

/**
 * mapping-config.json on disk = MappingConfig (consumed by the mapping
 * engine) plus two build-only fields the engine itself doesn't need:
 * `rawFile` (which file under raw/ to parse) and `passthroughFields` (top-
 * level keys to copy verbatim from the raw tree into the output bundle —
 * used by projects whose raw source is ALREADY a canonical dataset bundle,
 * e.g. Schependomlaan's fusionOutputs/asBuiltDeviations, which are outside
 * the mapping engine's plannedSchedule/projectMetadata scope).
 */
interface OnDiskMappingConfig extends MappingConfig {
  rawFile: string;
  passthroughFields?: string[];
}

function loadMappingConfig(projectId: string): OnDiskMappingConfig {
  const configPath = path.join(PROJECTS_DIR, projectId, "mapping-config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`No mapping-config.json for project "${projectId}" at ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as OnDiskMappingConfig;
}

function buildProject(projectId: string): void {
  const config = loadMappingConfig(projectId);
  const rawPath = path.join(PROJECTS_DIR, projectId, "raw", config.rawFile);
  const rawTree = parseRawFile(rawPath, config.sourceFormat as SourceFormat);

  const {
    plannedSchedule,
    projectMetadata,
    milestones,
    fusionOutputs: derivedFusionOutputs,
    asBuiltDeviations: derivedAsBuiltDeviations,
  } = runMappingEngine(config, rawTree);

  // Engine-derived (from config.asBuilt, real Actual* fields) is the default;
  // passthroughFields overrides for sources whose raw file IS ALREADY a
  // canonical bundle (Schependomlaan) — the two are mutually exclusive in
  // practice (a config sets one or the other, never both).
  let fusionOutputs: FusionOutput[] = derivedFusionOutputs;
  let asBuiltDeviations: AsBuiltDeviation[] = derivedAsBuiltDeviations;
  for (const key of config.passthroughFields ?? []) {
    const value = (rawTree as Record<string, unknown>)[key];
    if (key === "fusionOutputs" && Array.isArray(value)) fusionOutputs = value as FusionOutput[];
    if (key === "asBuiltDeviations" && Array.isArray(value)) asBuiltDeviations = value as AsBuiltDeviation[];
  }

  // A recovery-plan.json sitting beside the source means a recovery route is
  // ON OFFER for this snapshot — carried through to the payload so the
  // navigator can draw it as a previewable alternate route. Absent for
  // snapshots with no recovery available, which is most of them.
  const planPath = path.join(PROJECTS_DIR, projectId, "recovery-plan.json");
  const availableRecovery = fs.existsSync(planPath)
    ? (JSON.parse(fs.readFileSync(planPath, "utf8")) as RecoveryPlan)
    : undefined;

  const outPath = path.join(PROJECTS_DIR, projectId, "data.json");
  writeJson(outPath, {
    plannedSchedule,
    fusionOutputs,
    asBuiltDeviations,
    projectMetadata,
    milestones,
    ...(availableRecovery ? { availableRecovery } : {}),
  });

  const critical = plannedSchedule.filter((t) => t.isCriticalPath).length;
  const predecessorEdges = plannedSchedule.reduce((sum, t) => sum + (t.predecessors?.length ?? 0), 0);
  console.log(`Built ${projectId}:`);
  console.log(`  tasks: ${plannedSchedule.length}`);
  console.log(`  predecessor edges: ${predecessorEdges}`);
  console.log(`  critical-path tasks: ${critical}`);
  console.log(`  fusionOutputs: ${fusionOutputs.length}, asBuiltDeviations: ${asBuiltDeviations.length}`);
  console.log(`  milestones: ${milestones.length} (${milestones.map((m) => m.milestoneName).join(", ")})`);
  console.log(`  project: ${projectMetadata.projectName} (${projectMetadata.projectId})`);
}

function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("Usage: tsx build-project.ts <projectId>");
    process.exit(1);
  }
  buildProject(projectId);
}

if (require.main === module) {
  main();
}

export { buildProject };
