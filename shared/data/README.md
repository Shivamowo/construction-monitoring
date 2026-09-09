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
| `photos/` + `photos-attribution.json` | 4 | Pexels illustrative JPEGs and per-image attribution |

## Placeholder photos (Pexels)

Source the real illustrative construction images and their attribution sidecar with the opt-in Pexels workflow:

```bash
cd shared/scripts
PEXELS_API_KEY=<api-key> npm run source-photos
```

Obtain a free API key from [Pexels](https://www.pexels.com/api/) and provide it only through the environment; never commit it. The command writes JPEGs to `photos/` using the exact filenames in `photos.json`, and writes `photos-attribution.json` (Pexels URL, photographer name, profile URL, photo ID). It does not run during generation. The photo-to-component and milestone associations remain **FORGED**.

## Volumetric deviation note

`comparison_all weeks.xlsx` lists **missing elements** per week (Name / GUID / GlobalIDs). It does **not** provide per-component `volumetricDeviationPct`. That field is **FORGED** (schema annotation updated accordingly).
