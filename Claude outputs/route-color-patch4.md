# Patch 4: alt-route color never applied — fix now

Work directly. No confirmation.

`pathMeshes.ts` `createRoutePreviewLine`: color is still `#8f887c` (warm gray = same family as planned's `#5c584f`, hence still blends). Change to `#7d8ba0` (cool slate-blue).

`createRoutePreviewLabel`: `ctx.strokeStyle = "#8f887c"` → `"#7d8ba0"`.

CSS `.swatchAlternate` and `.axisKey[data-kind="route"]`: same `#8f887c` → `#7d8ba0` swap (verify these too — patch 2 asked for this, confirm it actually landed, fix if not).

Grep the whole `schedule-navigator-3d/` folder for remaining `8f887c` after this — should be zero hits. Same verification as before.
