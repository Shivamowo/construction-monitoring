/**
 * Stream 2 (+ partial Stream 3 onTimeStatus): Parse event log CSVs → schedule.json
 * Also writes intermediate asbuilt-status.json for fusion/deviations.
 */
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import {
  ASBUILT_CSV,
  DATA,
  PLANNED_CSV,
  DUTCH_TASK_TRANSLATIONS,
  resolveWeeklyIfcSnapshots,
  parseDutchDate,
  writeJson,
} from "./lib/paths";
import type { OnTimeStatus, PlannedTask } from "../schema/types";

export interface AsBuiltRow {
  componentId: string;
  taskId: string;
  taskName: string;
  taskNameEn: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  onTimeStatus: OnTimeStatus;
  ifcClass: string;
  material: string | null;
  classificationCode: string | null;
  buildingId: string;
}

function loadCsv(filePath: string): Record<string, string>[] {
  const text = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  if (parsed.errors.length) {
    console.warn(`CSV parse warnings for ${filePath}:`, parsed.errors.slice(0, 5));
  }
  return parsed.data;
}

function mapOnTime(raw: string | undefined | null): OnTimeStatus {
  const v = (raw ?? "").toString().trim().toLowerCase();
  if (v === "on time") return "on_time";
  if (v === "too late") return "too_late";
  return "unknown";
}

export interface ScheduleParseResult {
  schedule: PlannedTask[];
  asBuiltRows: AsBuiltRow[];
  eventGuids: Set<string>;
  expressIdToGuid: Map<number, string>;
  dateMin: string | null;
  dateMax: string | null;
  onTimeCounts: Record<OnTimeStatus, number>;
  uniqueTaskNames: string[];
}

export function parseSchedule(): ScheduleParseResult {
  console.log("Parsing planned CSV:", PLANNED_CSV);
  const planned = loadCsv(PLANNED_CSV);
  console.log("Parsing as-built CSV:", ASBUILT_CSV);
  const asbuilt = loadCsv(ASBUILT_CSV);

  // Prefer as-built file for schedule (same tasks + on-time flag); fall back to planned
  const source = asbuilt.length ? asbuilt : planned;

  const schedule: PlannedTask[] = [];
  const asBuiltRows: AsBuiltRow[] = [];
  const eventGuids = new Set<string>();
  const expressIdToGuid = new Map<number, string>();
  const onTimeCounts: Record<OnTimeStatus, number> = {
    on_time: 0,
    too_late: 0,
    unknown: 0,
  };
  const taskNames = new Set<string>();
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  for (const row of source) {
    const guid = (row.GUID ?? "").trim();
    if (!guid) continue;

    const res = (row.Resource ?? "").trim();
    const m = res.match(/\(#(\d+)\)/);
    if (m) {
      const eid = parseInt(m[1], 10);
      expressIdToGuid.set(eid, guid);
    }

    const taskId = (row.TaskID ?? row.Task ?? "").trim();
    const taskName = (row.TaskName ?? "").trim();
    const plannedStart = parseDutchDate(row.TaskStart);
    const plannedEnd = parseDutchDate(row.TaskFinish);
    if (!taskId || !taskName || !plannedStart || !plannedEnd) continue;

    const taskNameEn = DUTCH_TASK_TRANSLATIONS[taskName] ?? taskName;
    const weeklyIfcSnapshots = resolveWeeklyIfcSnapshots(plannedStart, plannedEnd);

    eventGuids.add(guid);
    taskNames.add(taskName);

    schedule.push({
      taskId,
      taskName,
      taskNameEn,
      plannedStart,
      plannedEnd,
      componentId: guid,
      weeklyIfcSnapshots,
      _provenance: {
        taskId: "REAL",
        taskName: "REAL",
        taskNameEn: "DERIVED",
        plannedStart: "REAL",
        plannedEnd: "REAL",
        componentId: "REAL",
        weeklyIfcSnapshots: "REAL",
      },
    });

    const onTimeStatus = mapOnTime(row["Element on time or not"]);
    onTimeCounts[onTimeStatus]++;

    asBuiltRows.push({
      componentId: guid,
      taskId,
      taskName,
      taskNameEn,
      plannedStart,
      plannedEnd,
      onTimeStatus,
      ifcClass: (row.IfcClass ?? row.ifcClass ?? "").trim(),
      material: (row.Material ?? "").trim() || null,
      classificationCode: (row["Nl-sfb"] ?? "").trim() || null,
      buildingId: (row.BuildingGUID ?? "").trim(),
    });

    for (const d of [plannedStart, plannedEnd]) {
      if (!dateMin || d < dateMin) dateMin = d;
      if (!dateMax || d > dateMax) dateMax = d;
    }
  }

  console.log(`Schedule rows: ${schedule.length}`);
  console.log(`Unique event GUIDs: ${eventGuids.size}`);
  console.log(`Mapped expressIDs to GUIDs: ${expressIdToGuid.size}`);
  console.log(`Date range: ${dateMin} → ${dateMax}`);
  console.log(`On-time counts:`, onTimeCounts);
  console.log(`Unique TaskNames: ${taskNames.size}`);

  writeJson(path.join(DATA, "schedule.json"), schedule);
  writeJson(path.join(DATA, "_asbuilt-rows.json"), asBuiltRows);

  return {
    schedule,
    asBuiltRows,
    eventGuids,
    expressIdToGuid,
    dateMin,
    dateMax,
    onTimeCounts,
    uniqueTaskNames: [...taskNames].sort(),
  };
}

if (require.main === module) {
  parseSchedule();
}
