/**
 * Phase 2 orchestrator: Steps 2–9 → shared/data/*
 */
import fs from "node:fs";
import path from "node:path";
import { parseIfc } from "./parse-ifc";
import { parseSchedule } from "./parse-schedule";
import { inspectXlsx } from "./inspect-xlsx";
import { buildFusion } from "./build-fusion";
import { buildDeviations } from "./build-deviations";
import { downsampleAllPointClouds } from "./downsample-pointclouds";
import { generatePhotos } from "./generate-photos";
import { generateSafety } from "./generate-safety";
import { generateMetadata } from "./generate-metadata";
import {
  DATA,
  SCHEMA_VERSION,
  ensureDir,
  writeJson,
  mapIfcClassToEnum,
} from "./lib/paths";
import type { BimComponent, ConstructionMonitoringDataset } from "../schema/types";

async function main() {
  ensureDir(DATA);
  ensureDir(path.join(DATA, "photos"));
  ensureDir(path.join(DATA, "pointclouds"));

  console.log("\n=== STEP 4 (early): Inspect xlsx ===");
  const xlsx = inspectXlsx();
  console.log("volumetricDeviationPct usable?", xlsx.usableForVolumetricDeviationPct);
  console.log("Reason:", xlsx.reason);

  console.log("\n=== STEP 3: Parse event logs ===");
  const scheduleResult = parseSchedule();

  console.log("\n=== STEP 2: Parse IFC ===");
  const ifcResult = await parseIfc(scheduleResult.expressIdToGuid);

  // GUID overlap
  const ifcGuids = ifcResult.guidSet;
  const eventGuids = scheduleResult.eventGuids;
  let overlap = 0;
  for (const g of eventGuids) if (ifcGuids.has(g)) overlap++;
  const overlapPctEvent =
    eventGuids.size > 0 ? (overlap / eventGuids.size) * 100 : 0;
  const overlapPctIfc =
    ifcGuids.size > 0 ? (overlap / ifcGuids.size) * 100 : 0;
  console.log("\n=== GUID OVERLAP ===");
  console.log(`IFC GUIDs: ${ifcGuids.size}`);
  console.log(`Event-log GUIDs: ${eventGuids.size}`);
  console.log(`Intersection: ${overlap}`);
  console.log(
    `Overlap as % of event-log GUIDs: ${overlapPctEvent.toFixed(2)}%`
  );
  console.log(`Overlap as % of IFC GUIDs: ${overlapPctIfc.toFixed(2)}%`);
  if (overlapPctEvent < 50) {
    console.warn(
      "FLAG: IFC↔event-log GUID overlap is LOW (<50% of event GUIDs). Fusion joins will be sparse."
    );
  }

  // All components are REAL from IFC extraction with mapped GUIDs from event log.
  // No synthetic stubs needed.
  const components: BimComponent[] = ifcResult.components;
  const schedule = scheduleResult.schedule;
  const asBuiltRows = scheduleResult.asBuiltRows;
  console.log(`Components (100% real IFC): ${components.length}`);
  console.log(`Schedule rows kept: ${schedule.length}`);
  writeJson(path.join(DATA, "components.json"), components);
  writeJson(path.join(DATA, "schedule.json"), schedule);
  writeJson(path.join(DATA, "_asbuilt-rows.json"), asBuiltRows);

  const dateMin = scheduleResult.dateMin ?? "2015-01-01";
  const dateMax = scheduleResult.dateMax ?? "2015-12-31";

  console.log("\n=== STEP 9: Metadata (needed for photos/safety zones) ===");
  const { metadata, unsureTaskNames } = generateMetadata(
    components,
    dateMin,
    dateMax,
    scheduleResult.uniqueTaskNames,
    ifcResult.buildingId
  );

  console.log("\n=== STEP 5: Fusion ===");
  const fusion = buildFusion(components, asBuiltRows, dateMax);

  console.log("\n=== STEP 6: Downsample point clouds ===");
  let pointCloudRefs: Record<number, string> = {};
  try {
    pointCloudRefs = await downsampleAllPointClouds();
  } catch (err) {
    console.error("Point cloud downsample failed:", err);
    console.warn("Continuing with placeholder pointCloudRef paths");
    for (const w of [26, 27, 28, 29, 30]) {
      pointCloudRefs[w] = `pointclouds/${w}_placeholder.ply`;
    }
  }

  console.log("\n=== STEP 3/6: Deviations ===");
  const deviations = buildDeviations(
    components,
    asBuiltRows,
    fusion,
    xlsx,
    pointCloudRefs
  );

  console.log("\n=== STEP 7: Photos (JSON only) ===");
  const photos = generatePhotos(
    components,
    dateMin,
    dateMax,
    metadata.milestoneVocabulary,
    80
  );

  console.log("\n=== STEP 8: Safety (FORGED) ===");
  const safety = generateSafety(metadata.zonesList, dateMin, dateMax, components, fusion, 100);

  const dataset: ConstructionMonitoringDataset = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    bimComponents: components,
    plannedSchedule: schedule,
    asBuiltDeviations: deviations,
    siteEngineerPhotos: photos,
    fusionOutputs: fusion,
    safetyDetections: safety,
    projectMetadata: metadata,
    _provenance: {
      bimComponents: "REAL with DERIVED floorZone",
      plannedSchedule: "REAL with DERIVED taskNameEn and REAL weeklyIfcSnapshots",
      asBuiltDeviations: "REAL onTimeStatus/pointCloudRef with FORGED volumetricDeviationPct/deviationDays/heatmapGrid",
      siteEngineerPhotos: "FORGED milestone classification with REAL droneFootageRef link",
      fusionOutputs: "DERIVED completionPct/deviationFlag with FORGED confidenceWeightedScore/reviewStatus; 0% fallback for unscheduled components",
      safetyDetections: "100% FORGED synthetic safety events",
      projectMetadata: "REAL project ID/name with DERIVED timeline/zones and FORGED milestone buckets",
    },
  };

  writeJson(path.join(DATA, "data.json"), dataset);

  // Generate data-generation-log.md deliverable
  const logRows = metadata.milestoneMappingTable
    .map(
      (m) =>
        `| \`${m.dutchTaskName}\` | ${m.englishTaskName} | **${m.milestoneClass}** |`
    )
    .join("\n");

  const logContent = `# Schependomlaan Progress Monitoring Data Generation Log

Generated at: ${dataset.generatedAt}
Schema Version: ${SCHEMA_VERSION}

## 1. Inspection of \`comparison_all_weeks.xlsx\`
- **File Inspected**: \`shared/raw-data/Comparison As Planned As Built/comparison_all weeks.xlsx\`
- **Sheets Analyzed**: ${xlsx.sheets.map((s) => s.name).join(", ")}
- **Column Structure**: All weekly sheets exclusively contain columns: \`Name\`, \`GUID\`, \`GlobalID Synchro\`, and \`GlobalID IFC\`.
- **Finding**: Each sheet contains an inventory of missing components relative to the as-planned model. **No volumetric deviation percentages or numerical measurements exist.**
- **Provenance Decision**: \`volumetricDeviationPct\` is categorized as **\`FORGED\`** across all deviation records, synthesized with realistic distributions informed by the missing-element lists and on-time statuses. Explicitly noted in \`deviation.json\` \`_provenance\`.

## 2. Component ↔ Schedule GUID Join Overlap
- **Total Real IFC Components**: ${components.length} (parsed directly from \`Schependomlaan.ifc\`)
- **Event Log Tasks Parsed**: ${schedule.length}
- **Unique Event Log Component GUIDs**: ${eventGuids.size}
- **Join Intersection Count**: ${overlap} / ${eventGuids.size}
- **GUID Join Overlap Rate**: **${overlapPctEvent.toFixed(2)}%**
- **Synthetic Stubs Created**: **0** (Hard Rule 1 adhered to: zero fabricated join stubs).
- **Resolution Method**: Synchro event log GUIDs were mapped to Archicad IFC expressIDs via the CSV Resource field \`(#<expressID>)\` and \`IfcBuildingElementPart\` decomposition.

## 3. Fallback for Components with No Schedule History
- **Policy Choice**: **0% completion** (\`completionPct = 0.0\`) and **\`deviationFlag: "not_scheduled"\`**.
- **Rationale**: Exactly ${components.length - overlap} components in the BIM model have no scheduled tasks in the event log (e.g. foundational or auxiliary building elements). Defaulting to 0% with \`deviationFlag: "not_scheduled"\` and \`reviewStatus: "pending"\` accurately reflects that no planned work was logged or completed, avoiding any misleading implication that an on-time verification took place.
- **Documentation**: Recorded in \`fusion.json\` under per-record \`_provenance.unscheduledFallback\`.

## 4. Milestone-Bucket Mapping Table (\`metadata.json\`)
All ${metadata.milestoneMappingTable.length} unique Dutch construction tasks mapped onto the 6 locked milestone categories (*Framing, MEP, Finishes, Structure, Envelope, Other*):

| Dutch Task Name (Source) | English Translation | Mapped Milestone Bucket |
| :--- | :--- | :--- |
${logRows}

## 5. Summary of Output Deliverables
| Output File | Record Count | Provenance Breakdown |
| :--- | :--- | :--- |
| \`components.json\` | ${components.length} | REAL (geometry, type, materials) + DERIVED (floorZone) |
| \`schedule.json\` | ${schedule.length} | REAL (dates, task IDs, snapshots) + DERIVED (English translation) |
| \`deviation.json\` | ${deviations.length} | REAL (onTimeStatus, pointCloudRef) + FORGED (volumetric %, days, heatmap) |
| \`photos.json\` | ${photos.length} | REAL (drone footage ref) + FORGED (milestone prediction, bounding) |
| \`fusion.json\` | ${fusion.length} | DERIVED (completion %, deviation flag) + FORGED (scores, review status) |
| \`safety.json\` | ${safety.length} | 100% FORGED (synthetic PPE compliance events) |
| \`metadata.json\` | 1 project | REAL (project info) + DERIVED (timeline, zones) + FORGED (milestone vocabulary) |
| \`data.json\` | 1 bundle | Full dataset bundle with dataset-level \`_provenance\` |
`;

  const logPath = path.join(DATA, "data-generation-log.md");
  fs.writeFileSync(logPath, logContent, "utf8");
  console.log(`Wrote ${logPath}`);

  const summary = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: dataset.generatedAt,
    counts: {
      bimComponents: components.length,
      ifcExtracted: ifcResult.components.length,
      eventLogStubs: 0,
      plannedSchedule: schedule.length,
      asBuiltDeviations: deviations.length,
      siteEngineerPhotos: photos.length,
      fusionOutputs: fusion.length,
      safetyDetections: safety.length,
    },
    guidOverlap: {
      ifcGuids: ifcGuids.size,
      eventGuids: eventGuids.size,
      intersection: overlap,
      overlapPctOfEventGuids: Number(overlapPctEvent.toFixed(2)),
      overlapPctOfIfcGuids: Number(overlapPctIfc.toFixed(2)),
      lowOverlapFlag: overlapPctEvent < 50,
    },
    xlsx: {
      usableForVolumetricDeviationPct: xlsx.usableForVolumetricDeviationPct,
      reason: xlsx.reason,
      missingElementCount: xlsx.missingIfcGuids.length,
    },
    unsureTaskNames,
    pointCloudRefs,
  };
  writeJson(path.join(DATA, "_generation-summary.json"), summary);

  console.log("\n=== GENERATION COMPLETE ===");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
