# Shared Schema

Single source of truth for both frontend variants (analytics dashboard and 3D digital twin). All shared data written in Phase 2 and all UI consumption in later phases **must** conform to the types and JSON Schema in this folder.

| File | Role |
|------|------|
| [`types.ts`](./types.ts) | TypeScript interfaces for all seven streams |
| [`schema.json`](./schema.json) | Equivalent JSON Schema (kept in sync with `types.ts`) |

## Streams

1. **BIM / Design Reference** — IFC-derived component identity, type, material, classification, geometry, and floor zone.
2. **Planned Schedule** — Construction task rows with planned dates linked to BIM components (Dutch task names from source logs).
3. **Deviation / As-Built** — On-time vs late status, volumetric/point-cloud deviation signals, and forged confidence/heatmap fields.
4. **Site Engineer Photos** — Synthetic photo–component links and milestone predictions (labels forged; image refs may point at real CC-licensed assets).
5. **Fusion Layer Output** — Per-component completion, confidence, deviation flag, and review status for UI consumption.
6. **Safety / PPE** — Fully synthetic site-safety detections (no real basis in the Schependomlaan dataset).
7. **Project Metadata** — Project identity, overall timeline, zones list, and milestone vocabulary mapping.

## REAL / DERIVED / FORGED legend

Every field is tagged in JSDoc (`types.ts`) and in JSON Schema `description` strings (`schema.json`):

| Tag | Meaning |
|-----|---------|
| **REAL** | Comes directly from the Schependomlaan (or related) real dataset with no semantic transformation |
| **DERIVED** | Computed or aggregated from real data (e.g. min/max dates, IFC spatial hierarchy labels) |
| **FORGED** | Fully synthetic; no real basis — will be generated in Phase 2 |

Some fields document both paths (e.g. `deviationDays`: DERIVED or FORGED depending on whether the source supplies enough date signal). Use sibling field `deviationDaysSource` (`"derived"` | `"forged"`) to record which path produced each value.

## Milestone vocabulary (locked)

`PredictedMilestoneClass` is **FINAL and LOCKED**: Framing, MEP, Finishes, Structure, Envelope, Other. `milestoneVocabulary` maps real Dutch `TaskName` values from the schedule logs onto these six buckets — it is not an open/TBD vocabulary.

## Root metadata

Every generated top-level data bundle must populate:

- `schemaVersion` — semver string
- `generatedAt` — ISO 8601 date-time

## Referential integrity (not enforced by JSON Schema)

JSON Schema validates shapes and enums only. It does **not** enforce that every `componentId` referenced in `plannedSchedule`, `asBuiltDeviations`, `siteEngineerPhotos`, or `fusionOutputs` actually exists in `bimComponents`. That check must be performed separately by the generation/validation script (`shared/scripts/validate-data.ts` — see Phase 2 Step 5/10).

## Contract

- Do not invent parallel field names or alternate enums in `dashboard/` or `3d-twin/`.
- Prefer importing from `types.ts` (or validating against `schema.json`) rather than duplicating shapes.
- Phase 2 populates `shared/data/`; this folder stays schema-only.
