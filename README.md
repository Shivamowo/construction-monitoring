# Construction Progress Monitoring

AI-powered system that compares planned construction (BIM models) against actual built reality (drone photogrammetry, site photos, and related site evidence). A Next.js analytics **dashboard** consumes a shared schema and dataset under `shared/`.

**Current state (2026-09-09):**

- **Phase 2 (data generation)** — largely done: core JSON streams live in `shared/data/` (`schedule`, `fusion`, `deviation`, `components`, `photos`, `safety`, `metadata`, plus bundled `data.json`). Validation report currently `ok: true`.
- **Dashboard** — Next.js app on port 3001 with a working 2D Schedule Navigator. Dev defaults to a small **dummy** navigator payload (`USE_DUMMY_DATA=true` in `dashboard/.env.local`); real cores remain on disk for later. A WebGL Navigator rebuild is planned (`ScheduleNavigator3D` placeholder only).
- **3D twin** — previous BIM/IFC viewer app and derived point-cloud alignment outputs were **removed** (raw IFC under `shared/raw-data/` kept).
- **Phase 3 (broader product/PRDs / remaining views)** — still open (six secondary dashboard views, WebGL Navigator implementation).

Schema definition: [`shared/schema/README.md`](shared/schema/README.md). Agent task log: [`PROJECT_OUTPUT.md`](PROJECT_OUTPUT.md).
