TOKEN DISCIPLINE. Terse. No narration. Diagnose confirmed below — implement, don't re-diagnose.

# Fix: critical path + milestones perceptually invisible

Not a wiring bug. Confirmed in `pathMeshes.ts`: both are built from hairline/wireframe primitives that get swallowed by the glossy tube geometry and scene clutter.

## Root cause

- `createProjectedEmphasisLine`: a `THREE.Line` (WebGL caps width ~1px regardless of settings) offset only `z += 0.055` from the projected tube (radius `0.07`, glossy `MeshPhysicalMaterial`). It sits on/inside the tube surface — effectively invisible.
- `createCriticalPathMarker`: `EdgesGeometry` wireframe box, no fill, slack opacity `0.3`. Outline-only at this scale reads as nothing.
- `createMilestoneMarker`: same pattern — wireframe box + a `0.018`-radius stem. No solid fill, easily lost.

## Fix

**Critical path — replace hairline overlay with a solid accent tube:**
- Delete `createProjectedEmphasisLine`/`updateProjectedEmphasisLine` hairline approach.
- For critical segments only, add a solid `TubeGeometry` overlay along that stretch of the projected curve: radius `0.095` (visibly wider than the base `0.07` projected tube — reads as a highlighted band, not a decal), color `#b34c2e`, opacity `0.85`, no dash. Slack segments: no overlay, leave base tube as-is — don't add competing visual noise for "normal."
- Replace `createCriticalPathMarker`'s wireframe box with a small **solid filled diamond** (e.g. `OctahedronGeometry` squashed, or a flat solid `ShapeGeometry` diamond), `MeshBasicMaterial`, same `#b34c2e`, positioned just above the tube surface (offset up, not embedded) at the critical waypoint node only.

**Milestones — replace wireframe with a solid flag marker:**
- Reuse the today-marker's proven visual grammar (solid needle + solid crossbar/collar — already established as legible per `PROJECT_OUTPUT.md`), not a new wireframe shape.
- Solid stem (thicker than `0.018` — match today-marker's needle weight) + a solid filled flag/disc at the top, not an edges-only box.
- Color: reached `#2f7f6f`, upcoming `#b27a34` (unchanged). Position above the tube surface, same offset logic as the diamond above.

**Keep it clean per explicit direction:** no new text stats, no extra labels — just the improved solid markers + in-line accent tube. Filter chips, camera choreography, existing planned/actual/projected/delay-shard styling: untouched.

## Verify

Real headless screenshot (puppeteer-core), not tsc/HTTP-200 alone:
- Critical segments visibly read as a thicker/rust-colored band along the projected line vs. plain segments.
- Milestone markers visible as solid flag shapes at their waypoints, clearly distinct from delay/forecast crystal shards.
- No regression to existing lines/curves/shards/camera/filters.

Update `PROJECT_OUTPUT.md`.
