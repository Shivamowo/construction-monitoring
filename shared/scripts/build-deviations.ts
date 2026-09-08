/**
 * Stream 3: AsBuiltDeviation records + point-cloud refs.
 * volumetricDeviationPct is FORGED (xlsx not usable — see inspect-xlsx).
 */
import path from "node:path";
import { DATA, seededRandom, writeJson } from "./lib/paths";
import type { AsBuiltRow } from "./parse-schedule";
import type { XlsxInspection } from "./inspect-xlsx";
import type {
  AsBuiltDeviation,
  BimComponent,
  FusionOutput,
  OnTimeStatus,
} from "../schema/types";

export function buildDeviations(
  components: BimComponent[],
  asBuiltRows: AsBuiltRow[],
  fusion: FusionOutput[],
  xlsx: XlsxInspection,
  pointCloudRefsByWeek: Record<number, string>
): AsBuiltDeviation[] {
  const fusionById = new Map(fusion.map((f) => [f.componentId, f]));
  const rowsByComp = new Map<string, AsBuiltRow[]>();
  for (const r of asBuiltRows) {
    const list = rowsByComp.get(r.componentId) ?? [];
    list.push(r);
    rowsByComp.set(r.componentId, list);
  }
  const missingSet = new Set(xlsx.missingIfcGuids);

  // Pick a default point cloud ref (latest week available)
  const weeks = Object.keys(pointCloudRefsByWeek)
    .map(Number)
    .sort((a, b) => a - b);
  const defaultRef =
    weeks.length > 0
      ? pointCloudRefsByWeek[weeks[weeks.length - 1]]
      : "pointclouds/missing.ply";

  const out: AsBuiltDeviation[] = [];

  for (const comp of components) {
    const rows = rowsByComp.get(comp.componentId) ?? [];
    const fus = fusionById.get(comp.componentId);
    const rand = seededRandom(`dev:${comp.componentId}`);

    let onTimeStatus: OnTimeStatus = "unknown";
    for (const r of rows) {
      if (r.onTimeStatus === "too_late") {
        onTimeStatus = "too_late";
        break;
      }
      if (r.onTimeStatus === "on_time") onTimeStatus = "on_time";
    }

    // deviationDays: no actual finish dates in source → FORGED
    // Synthesize consistently with onTimeStatus
    let deviationDays: number | null;
    let deviationDaysSource: "derived" | "forged";
    if (onTimeStatus === "too_late") {
      deviationDays = Math.round(3 + rand() * 21);
      deviationDaysSource = "forged";
    } else if (onTimeStatus === "on_time") {
      deviationDays = Math.round((rand() - 0.7) * 4); // mostly 0 / slightly early
      deviationDaysSource = "forged";
    } else {
      deviationDays = null;
      deviationDaysSource = "forged";
    }

    // volumetricDeviationPct FORGED — skew higher if missing in xlsx or behind
    let volumetricDeviationPct = rand() * 8;
    if (missingSet.has(comp.componentId)) volumetricDeviationPct += 12 + rand() * 20;
    if (onTimeStatus === "too_late") volumetricDeviationPct += 5 + rand() * 10;
    if (fus?.deviationFlag === "behind") volumetricDeviationPct += 3;
    volumetricDeviationPct = Math.round(volumetricDeviationPct * 100) / 100;

    // Assign week by hashing component into available weeks
    const week = weeks.length ? weeks[Math.floor(rand() * weeks.length)] : 30;
    const pointCloudRef = pointCloudRefsByWeek[week] ?? defaultRef;

    // FORGED confidence — worse for too_late / behind / low completion
    let pointCloudConfidence = 0.55 + rand() * 0.4;
    if (onTimeStatus === "too_late") pointCloudConfidence -= 0.25;
    if (fus?.deviationFlag === "behind") pointCloudConfidence -= 0.1;
    if ((fus?.completionPct ?? 0) < 40) pointCloudConfidence -= 0.1;
    pointCloudConfidence = Math.max(0.05, Math.min(0.98, pointCloudConfidence));
    pointCloudConfidence = Math.round(pointCloudConfidence * 1000) / 1000;

    // FORGED heatmap 8x8 — higher cells when behind
    const base = onTimeStatus === "too_late" ? 0.45 : onTimeStatus === "on_time" ? 0.12 : 0.25;
    const heatmapGrid: number[][] = [];
    for (let y = 0; y < 8; y++) {
      const row: number[] = [];
      for (let x = 0; x < 8; x++) {
        const v = Math.max(0, Math.min(1, base + (rand() - 0.5) * 0.35 + volumetricDeviationPct / 200));
        row.push(Math.round(v * 1000) / 1000);
      }
      heatmapGrid.push(row);
    }

    out.push({
      componentId: comp.componentId,
      onTimeStatus,
      deviationDays,
      deviationDaysSource,
      volumetricDeviationPct,
      pointCloudRef,
      pointCloudConfidence,
      heatmapGrid,
      _provenance: {
        componentId: "REAL",
        onTimeStatus: "REAL",
        deviationDays: "FORGED",
        deviationDaysSource: "FORGED",
        volumetricDeviationPct: "FORGED",
        pointCloudRef: "REAL",
        pointCloudConfidence: "FORGED",
        heatmapGrid: "FORGED",
        note: "volumetricDeviationPct is FORGED because comparison_all_weeks.xlsx lists only missing element GUIDs, not volumetric percentages. deviationDays is FORGED from real onTimeStatus due to absence of actual completion dates in source logs.",
      },
    });
  }

  writeJson(path.join(DATA, "deviation.json"), out);
  return out;
}
