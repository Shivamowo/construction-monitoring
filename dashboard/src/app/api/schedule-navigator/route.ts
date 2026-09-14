import { NextResponse } from "next/server";
import type {
  AsBuiltDeviation,
  FusionOutput,
  PlannedTask,
  ProjectMetadata,
} from "@shared/schema/types";
import { loadJsonFile } from "@/lib/data/loadJson";
import {
  buildScheduleNavigatorPayload,
  type ScheduleNavigatorPayload,
} from "@/lib/schedule-navigator/aggregate";

export const runtime = "nodejs";

export async function GET() {
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

    // schedule.json/fusion.json/deviation.json/metadata.json are not split out
    // on disk yet — data.json still bundles everything. Destructure from there
    // instead of regenerating the split files (the split generation script is
    // more fragile: it depends on raw drone/IFC inputs not guaranteed present).
    const bundle = loadJsonFile<{
      plannedSchedule: PlannedTask[];
      fusionOutputs: FusionOutput[];
      asBuiltDeviations: AsBuiltDeviation[];
      projectMetadata: ProjectMetadata;
    }>("data.json");
    const schedule = bundle.plannedSchedule;
    const fusion = bundle.fusionOutputs;
    const deviations = bundle.asBuiltDeviations;
    const metadata = bundle.projectMetadata;

    const payload = buildScheduleNavigatorPayload(
      schedule,
      fusion,
      deviations,
      metadata
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
