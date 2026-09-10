# Patch 3: alternate-route thickness/opacity

Work directly, no confirmation, minimal output.

In `pathMeshes.ts`, `createRoutePreviewLine` (now a tube per patch 2):
- Radius: `0.05` → `0.075` (close to actual `0.085`/projected `0.07`, still less than taken `0.1` — visible from afar, not competing with the current path).
- Opacity: `0.75` → `0.45` (thickness carries visibility now; lower opacity keeps it reading as "not the path you're on," distinct from the solid taken-route look).

No other color/position changes. Same verification as before (tsc, build, headless check, log to `PROJECT_OUTPUT.md`).
