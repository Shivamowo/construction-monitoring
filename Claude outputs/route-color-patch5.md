# Patch 5: alt-route mesh geometrically overlaps current route

Work directly. No confirmation.

Cause: `createRoutePreviewLine` only offsets `position.y += 0.03`. That was fine for a hairline `Line`, but it's now a tube of radius `0.075` — 0.03 isn't enough clearance from the taken-route tube (radius `0.1`) or actual tube (radius `0.085`) wherever the curves run close, so the meshes intersect/clip.

Fix in `pathMeshes.ts`:
- Raise `createRoutePreviewLine`'s y-offset from `0.03` to at least `0.22` (must clear: alt-route radius `0.075` + taken/actual radius `~0.1` + margin `~0.05`).
- At the branch point (where preview leaves the delay shard), ease the curve's first segment upward faster so it visibly lifts off the main path immediately, not just at a flat offset — avoid a long touching/tangent run near the origin.
- After the change, verify no z-fighting/intersection: sample both curves at matching t, confirm 3D distance between them is always > (sum of both radii + 0.03) along the full length, not just at the offset origin.

Update anything that reads this offset for label/tick placement (`route-preview-label`, axis DOM sync) to match the new y.

Same verification as before + confirm via headless screenshot the alt-route visibly separates from the current path along its entire length, not just at the far end.
