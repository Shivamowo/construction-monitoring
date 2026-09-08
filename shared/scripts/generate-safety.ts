import path from "node:path";
import { DATA, seededRandom, writeJson } from "./lib/paths";
import type {
  BimComponent,
  FusionOutput,
  ResolutionStatus,
  SafetyDetection,
  Severity,
  ViolationType,
} from "../schema/types";

const VIOLATIONS: ViolationType[] = [
  "no_hard_hat",
  "no_safety_vest",
  "no_harness",
  "restricted_zone",
  "other",
];

/** Realistic-ish severity weights (not uniform). */
function pickSeverity(rand: () => number): Severity {
  const r = rand();
  if (r < 0.45) return "low";
  if (r < 0.75) return "medium";
  if (r < 0.93) return "high";
  return "critical";
}

function pickViolation(rand: () => number): ViolationType {
  const r = rand();
  if (r < 0.32) return "no_hard_hat";
  if (r < 0.55) return "no_safety_vest";
  if (r < 0.72) return "restricted_zone";
  if (r < 0.88) return "no_harness";
  return "other";
}

function pickResolution(rand: () => number, severity: Severity): ResolutionStatus {
  if (severity === "critical") return rand() < 0.7 ? "resolved" : "acknowledged";
  const r = rand();
  if (r < 0.35) return "resolved";
  if (r < 0.55) return "acknowledged";
  if (r < 0.75) return "open";
  return "dismissed";
}

export function generateSafety(
  zonesList: string[],
  dateMin: string,
  dateMax: string,
  components?: BimComponent[],
  fusion?: FusionOutput[],
  count = 100
): SafetyDetection[] {
  const zones = zonesList.length ? zonesList : ["Unknown"];
  const start = Date.parse(`${dateMin}T08:00:00Z`);
  const end = Date.parse(`${dateMax}T18:00:00Z`);
  const span = Math.max(1, end - start);

  const fusionMap = new Map((fusion ?? []).map((f) => [f.componentId, f]));

  // Active components with real schedule tasks / progress (> 0% and not "not_scheduled")
  const activeComps = (components ?? []).filter((c) => {
    const f = fusionMap.get(c.componentId);
    return f && f.completionPct > 0 && f.deviationFlag !== "not_scheduled";
  });

  // Components with significant progress (>= 20%) for high / critical severity violations
  const highActivityComps = activeComps.filter((c) => {
    const f = fusionMap.get(c.componentId);
    return f && f.completionPct >= 20;
  });

  const events: SafetyDetection[] = [];
  for (let i = 0; i < count; i++) {
    const rand = seededRandom(`safety:${i}`);
    const severity = pickSeverity(rand);
    const violationType = pickViolation(rand);
    let confidenceScore = 0.55 + rand() * 0.4;
    if (severity === "critical") confidenceScore = Math.max(confidenceScore, 0.8);
    confidenceScore = Math.round(confidenceScore * 1000) / 1000;

    // Pick a real active component in the site
    let comp: BimComponent | undefined;
    if (severity === "high" || severity === "critical") {
      const pool = highActivityComps.length ? highActivityComps : activeComps;
      if (pool.length) comp = pool[Math.floor(rand() * pool.length)];
    } else if (activeComps.length) {
      comp = activeComps[Math.floor(rand() * activeComps.length)];
    }

    const zone = comp?.floorZone ?? zones[Math.floor(rand() * zones.length)];
    const componentId = comp?.componentId;

    events.push({
      detectionId: `safe-${String(i + 1).padStart(4, "0")}`,
      timestamp: new Date(start + rand() * span).toISOString(),
      zone,
      componentId,
      violationType,
      severity,
      confidenceScore,
      resolutionStatus: pickResolution(rand, severity),
      _provenance: {
        detectionId: "FORGED",
        timestamp: "FORGED",
        zone: "REAL (active zone from IFC)",
        componentId: "REAL (active component under construction)",
        violationType: "FORGED",
        severity: "FORGED",
        confidenceScore: "FORGED",
        resolutionStatus: "FORGED",
        note: "Stream is synthetic for automated PPE compliance, guaranteed assigned only to zones and components with verified ongoing construction activity.",
      },
    });
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  writeJson(path.join(DATA, "safety.json"), events);
  return events;
}
