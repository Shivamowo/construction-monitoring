import { NextResponse } from "next/server";
import type {
  AsBuiltDeviation,
  FusionOutput,
  Milestone,
  PlannedTask,
  ProjectMetadata,
  RecoveryPlan,
} from "@shared/schema/types";
import { loadJsonFile } from "@/lib/data/loadJson";
import {
  buildScheduleNavigatorPayload,
  type ScheduleNavigatorPayload,
} from "@/lib/schedule-navigator/aggregate";

export const runtime = "nodejs";

/**
 * Project onboarded via the dynamic ingestion pipeline (shared/scripts/
 * build-project.ts) when no `?project=` query param is given. Every
 * onboarded project's pre-built bundle lives at
 * shared/data/projects/<id>/data.json — see dynamic-project-ingestion-plan.md.
 */
const DEFAULT_PROJECT_ID = "mspdi-sample";

export async function GET(request: Request) {
  try {
    if (process.env.USE_DUMMY_DATA === "true") {
      const payload = loadJsonFile<ScheduleNavigatorPayload & { dataProvenance?: string }>(
        "dummy/schedule-navigator-dummy.json"
      );
      return NextResponse.json(payload, {
        headers: {
          "Cache-Control": "public, max-age=60",
          "X-Data-Provenance": payload.dataProvenance ?? "dummy",
        },
      });
    }

    const projectId =
      new URL(request.url).searchParams.get("project") || DEFAULT_PROJECT_ID;

    // Each onboarded project's data.json is pre-built by build-project.ts
    // (raw source -> raw-parser -> mapping-engine) — route.ts only ever
    // reads the already-built bundle, never runs the mapping pipeline
    // itself, so a request never pays ingestion latency.
    const bundle = loadJsonFile<{
      plannedSchedule: PlannedTask[];
      fusionOutputs: FusionOutput[];
      asBuiltDeviations: AsBuiltDeviation[];
      projectMetadata: ProjectMetadata;
      availableRecovery?: RecoveryPlan;
      milestones?: Milestone[];
    }>(`projects/${projectId}/data.json`);
    const schedule = bundle.plannedSchedule;
    const fusion = bundle.fusionOutputs;
    const deviations = bundle.asBuiltDeviations;
    const metadata = bundle.projectMetadata;
    const milestones = bundle.milestones ?? [];

    const payload = buildScheduleNavigatorPayload(
      schedule,
      fusion,
      deviations,
      metadata,
      milestones,
      bundle.availableRecovery
    );

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
