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

    const schedule = loadJsonFile<PlannedTask[]>("schedule.json");
    const fusion = loadJsonFile<FusionOutput[]>("fusion.json");
    const deviations = loadJsonFile<AsBuiltDeviation[]>("deviation.json");
    const metadata = loadJsonFile<ProjectMetadata>("metadata.json");

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
