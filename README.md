# Construction Progress Monitoring

AI-powered system that compares planned construction (BIM models) against actual built reality (drone photogrammetry, site photos, and related site evidence). A Next.js analytics **dashboard** consumes a shared schema and dataset under `shared/`.

**Current state (2026-09-14):**

- **Phase 2 (data generation)** — done: core JSON streams live in `shared/data/` (`schedule`, `fusion`, `deviation`, `components`, `photos`, `safety`, `metadata`, plus bundled `data.json`). Validation report `ok: true`.
- **Dashboard** — Next.js app on port 3001. The home route (`/`) now renders a full **3D Schedule Navigator** (`ScheduleNavigator3D`, WebGL/Three.js scene) with a scrubbable timeline rail, delay-shard cards, catch-up/reroute mechanics, and axis/legend overlays — no longer a placeholder. Dev defaults to a dummy navigator payload (`USE_DUMMY_DATA=true` in `dashboard/.env.local`); real data aggregation from `schedule.json`/`fusion.json`/`deviation.json` is wired but toggled off by default.
- **3D twin** — the earlier standalone BIM/IFC viewer app (`3d-twin/`) has been **removed**; the raw IFC source files remain under `shared/raw-data/`.
- **Remaining dashboard views** — six secondary views (Project Overview, Progress Summary, Schedule Deviation, Milestone Breakdown, Safety Overview, Photo Stream) exist only as disabled "soon" nav entries in `AppShell`; no routes/pages implemented yet.

Schema definition: [`shared/schema/README.md`](shared/schema/README.md). Agent task log: [`PROJECT_OUTPUT.md`](PROJECT_OUTPUT.md).
