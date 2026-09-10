# Recolor Schedule Navigator route lines

Work directly. Don't ask for confirmation, don't explain back the plan, minimize output — just make the edits and report results per the Verification section.

## Palette (implement exactly)

| Role | File(s) | Old | New | Notes |
|---|---|---|---|---|
| Planned reference | `pathMeshes.ts` `createPlannedTube`; CSS `.swatchPlanned`; `.axisKey[data-kind="plannedEnd"]` | `#3a5b7e` (also `.swatchPlanned` is wrongly `#2f7f8f`) | `#5c584f` | Add `transparent:true, opacity:0.55` to the tube material |
| Actual to date | `pathMeshes.ts` `createActualTube`; CSS `.swatchActual` | `#1f7a6c` (`.swatchActual` is wrongly a cream/tan gradient) | unchanged / fix swatch to flat `#1f7a6c` | No other change |
| Projected / at-risk | `pathMeshes.ts` `createOrUpdateProjectedTube` + `createProjectedDashLine`; CSS `.swatchProjected` (`#c45a32`); `.axisKey[data-kind="projectedEnd"]` | `#bf5b3f` | `#c98a3a` | Apply to tube + dash overlay + swatch + axis label, all in sync |
| Alternate route preview | `pathMeshes.ts` `createRoutePreviewLine` + `createRoutePreviewLabel`; CSS `.swatchAlternate`; `.axisKey[data-kind="route"]` | `#5f7a4f`, dashed, opacity 0.85 | `#8f887c`, **solid** (`LineBasicMaterial`, no dash), opacity 0.5 (swatch 0.6) | Label stroke/fill → `#8f887c` / `#4a463d` |
| Taken / committed route | — | `#1a73e8` | unchanged | Stays the only blue in the palette |
| Ghost (superseded) | `pathMeshes.ts` `createGhostRouteLine` | `#9a958c` dashed @0.32 opacity | same hue, opacity **0.2** | Keep dashed |

**Do not touch:** delay-shard red `#a11d22`, milestone marker colors, critical-path overlay colors (`#b34c2e`/`#9a958c` in pathMeshes.ts + journeyController.ts), today-marker, scrub-playhead cursor (`#f4f7fb`/`#c4d0dc`), `--chrome-accent` and its button/CTA usages (lines ~25-30, 244, 729, 908, 936, 1458-1503 in the CSS module — same hex as old alternate-route color but drives unrelated UI chrome). Add a new CSS var for the route-preview gray instead of repointing `--chrome-accent`.

## Verification

- `tsc --noEmit` clean, `npm run build` clean.
- Headless check at `http://localhost:3001/dev/schedule-navigator-3d`: 0 console errors, alternate-route line solid+gray, legend swatches match scene, no button/CTA appearance changed.
- Log a dated entry in `PROJECT_OUTPUT.md` per existing format.
