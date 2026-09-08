# Shared Data (Phase 2)

Generated outputs consumed by `dashboard/` and `3d-twin/`. Regenerate with:

```bash
cd shared/scripts
npm install
npm run generate
npm run validate
```

## Files

| File | Stream | Provenance notes |
|------|--------|------------------|
| `components.json` | 1 BIM | REAL from IFC (+ rare event-log stubs for GUID integrity) |
| `schedule.json` | 2 Schedule | REAL from event logs |
| `deviation.json` | 3 As-built | onTimeStatus REAL; deviationDays mostly FORGED; volumetricDeviationPct FORGED; point clouds REAL refs |
| `photos.json` | 4 Photos | FORGED records; `imageRef` → placeholders |
| `fusion.json` | 5 Fusion | completionPct / deviationFlag DERIVED; scores/status FORGED |
| `safety.json` | 6 Safety | 100% FORGED |
| `metadata.json` | 7 Metadata | timeline/zones DERIVED; milestoneVocabulary maps Dutch tasks → locked buckets |
| `data.json` | Bundle | Full schema root incl. `schemaVersion` + `generatedAt` |
| `pointclouds/` | 3 | Voxel-downsampled real PLYs |
| `photos/` | 4 | **Empty placeholders dir — see TODO below** |

## TODO (manual human step)

Do **not** scrape or auto-download photos. Source CC-licensed site/construction images manually and drop them into `shared/data/photos/` using the filenames referenced in `photos.json` (e.g. `placeholder-001.jpg`, `placeholder-002.jpg`, …).

## Volumetric deviation note

`comparison_all weeks.xlsx` lists **missing elements** per week (Name / GUID / GlobalIDs). It does **not** provide per-component `volumetricDeviationPct`. That field is **FORGED** (schema annotation updated accordingly).
