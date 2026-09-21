# Project Output Log

**Canonical output file for agent tasks.** When you ask for work, results are written here (updated in place) rather than only in chat.

Last updated: 2026-09-11

---

## How to use

- Tell the agent what to do as usual.
- Expect this file to be updated with the latest findings, deliverables, and status.
- Chat replies stay short; **details live here**.

---

## Current status snapshot

### Apps

| Path | State |
|------|--------|
| `3d-twin/` | **Removed** (2026-09-09) — old BIM/IFC viewer retired |
| `dashboard/` | Next.js 16 — 2D Schedule Navigator on `/`; WebGL Navigator on `/dev/schedule-navigator-3d` |
| Schema | `shared/schema/types.ts` — imported read-only by dashboard; not modified |

### Dashboard data

| Item | Value |
|------|--------|
| Default source | **Dummy** via `USE_DUMMY_DATA=true` in `dashboard/.env.local` |
| Dummy file | `shared/data/dummy/schedule-navigator-dummy.json` (`dataProvenance: "dummy"`, 9 waypoints) |
| Real cores | `schedule.json` / `fusion.json` / `deviation.json` / `metadata.json` **kept** — not wired while flag is true |
| Dev | `cd dashboard && npm run dev` → http://localhost:3001 |

### Photos (Pexels placeholders)

| Item | Value |
|------|--------|
| Images | 80/80 in `shared/data/photos/` |
| Attribution | `shared/data/photos-attribution.json` |
| Script | `shared/scripts/source-pexels-photos.ts` |
| `photos.json` | Untouched (links remain FORGED) |

### Point clouds

**Removed** (2026-09-09): `shared/data/pointclouds/` (sources + meters + alignment-manifest), `align-pointclouds.ts`, `downsample-pointclouds.ts`. Raw IFC under `shared/raw-data/` kept. Core pipeline scripts kept.

---

## Task history

### 2026-09-11 — Full-screen toggle for Schedule Navigator

- Added a real Fullscreen API toggle (`element.requestFullscreen()` / `document.exitFullscreen()`, not CSS-only) on `.stage` — chosen over `.viewport` (canvas-only) because `.stage` is the common ancestor of the canvas, status bar, filter chips, AND the legend `<aside>`, so one fullscreen call brings all of it along while leaving the outer app header/nav (which lives outside this component) behind.
- Button top-right of the viewport (`.fullscreenBtn`, matches the existing light/cream + `--chrome-accent` hover theme used by `.zoomBtn`), icon swaps expand↔collapse based on `document.fullscreenElement`, synced via a `fullscreenchange` listener (not just the click handler) so it stays correct if the user exits via Esc.
- On `fullscreenchange`, calls the same `controller.setSize(hostRef.clientWidth, hostRef.clientHeight)` the existing window-resize handler uses — once immediately and once again on the next animation frame, since the browser's own fullscreen resize can land a frame before the descendant layout (and therefore `hostRef`'s new `clientWidth/clientHeight`) has actually settled.
- Added a `.stage:fullscreen` (+ `-webkit-` prefix) CSS rule giving it an explicit cream background — the fullscreen element's own background is what shows during fullscreen (not `.root`'s, which is now an inert ancestor), and without this rule fullscreen would show through to the browser's default black backdrop.

**Verification:** `tsc --noEmit` clean; `npm run build` clean. Real headless Chrome at `http://localhost:3001/`: HTTP 200, 0 console/page errors. Clicked the toggle — `document.fullscreenElement` became the `.stage` element, the button's `aria-label` flipped `Enter fullscreen`→`Exit fullscreen`, and the canvas's actual pixel dimensions grew from `946×606` to `1018×784` (confirming the resize handler fired and the WebGL canvas wasn't left clipped at its pre-fullscreen size). Clicked again — `document.fullscreenElement` returned to `null`. Screenshot in the fullscreen state confirms the outer "Construction Monitor" header/nav is gone, the canvas fills the browser viewport, and the filter bar/legend/scrubber/zoom controls all scale and reposition correctly rather than clipping or overflowing.

### 2026-09-11 — Critical path + milestones: solid markers, gated toggle

- Root cause confirmed as diagnosed: `createProjectedEmphasisLine` was a hairline `THREE.Line` only `z += 0.055` off the glossy `0.07`-radius projected tube — effectively invisible. `createCriticalPathMarker`/`createMilestoneMarker` were `EdgesGeometry` wireframe boxes with no fill, unreadable at this scale.
- **Critical path**: replaced the hairline overlay with `createCriticalPathAccentTube`/`updateCriticalPathAccentTube` (`pathMeshes.ts`) — a solid `TubeGeometry` band (radius `0.095`, `MeshBasicMaterial`, color `#b34c2e`, opacity `0.85`, no dash) along critical segments only; slack segments get no overlay at all. `createCriticalPathMarker` rewritten as a solid squashed-octahedron diamond (`MeshBasicMaterial`, same rust color, offset `0.13` above the tube surface via the new exported `CRITICAL_MARKER_Y_OFFSET`), shown only at critical waypoints — slack waypoints get no marker (removing the old dimmed-duplicate-of-everything clutter).
- **Milestones**: `createMilestoneMarker` rewritten to reuse the today-marker's proven grammar — solid needle (`0.02` width, matching the today-marker), a solid filled flag disc at the top (not an edges box), and a small collar ring grounding it to the tube. Colors unchanged (`#2f7f6f` reached / `#b27a34` upcoming).
- `journeyController.ts`: `criticalAccentTubes` is now a fixed-size array aligned to `model.projectedSegments`, with a mesh only where a segment is currently critical — `refreshCriticalMarkers()` creates/disposes meshes in place as segments flip between critical and slack after a route commit (rather than always updating a permanent 1:1 line array).
- **Amendment applied in the same pass**: gated critical-path visuals (accent tube + diamond markers only — milestones stay always-visible, unchanged) behind a new toggle chip, default **off**. Added `setCriticalPathVisible(enabled)` to the controller, reusing the exact `.visible`-toggling mechanism the shard category/severity filters already use — no new control type. Chip added to the existing `FILTER SHARDS` bar (`ScheduleNavigator3D.tsx`), same styling/row as the category/severity chips.

**Verification:** `tsc --noEmit` clean; `npm run build` clean. Real headless Chrome at `http://localhost:3001/`: HTTP 200, 0 console/page errors. A base64-round-trip pixel-sampling approach (as used for earlier color patches this session) hung indefinitely on this page specifically — passing a screenshot's base64 string as an `evaluate()` argument timed out the CDP `Runtime.callFunctionOn` call every time, even cropped to just the canvas region; root cause not chased down since a screenshot-to-file-then-visual-read approach (this agent can read image files directly) worked immediately and gave a more direct answer anyway. Confirmed via before/after screenshots: toggle chip aria-pressed flips `false`→`true`, a solid rust-colored band appears along the critical stretch of the projected curve only when the toggle is on (absent when off), and a zoomed crop shows a solid diamond marker and a solid needle+flag milestone marker both rendering distinctly — no wireframe, no invisibility.

### 2026-09-11 — Route/delay card: re-anchor to scene, boost cost-block hierarchy

- Confirmed diagnosis: the card rendered inside a fixed `<aside>`, disconnected from the clicked route/shard's scene location, with no pointer/leader line. `getShardScreenAnchor()` existed on the controller but nothing called it.
- Added `getRouteScreenAnchor(waypointId)` to the controller (`journeyController.ts`) — projects an alternate-route's midpoint (same point its DOM label anchors to, lift included) to screen space, mirroring `getShardScreenAnchor`. Factored the shared NDC-to-pixel projection into one `projectLocalToScreen` helper used by both.
- `ScheduleNavigator3D.tsx`: added a `requestAnimationFrame` loop keyed on `selected`/`selectedRoute` that polls the appropriate anchor getter every frame and converts it into page-fixed coordinates via the host container's bounding rect. The card (`.routeSection`) is now `position: fixed`, positioned via inline style from that live anchor (clamped on-screen with a fixed offset so it doesn't sit on top of the shard/route geometry), and fades to `opacity: 0` when the anchor reports off-screen. Same mechanism drives both the alternate-route card and the delay/forecast card — one code path, no branching.
- Added an SVG leader line + dot (`.leaderLineSvg`/`.leaderLine`/`.leaderDot`) from the anchor point to the card's near edge, redrawn every frame alongside the card.
- The `<aside>` now holds only the Legend; the card moved out of the docked side-panel flow entirely into the floating popover. Updated the stale `.card` comment that explicitly said "not a floating popover" (that was the box this patch reversed).
- Hierarchy boost: `.routeOptionSuggested` (the cost/consequence block — "−6d · +2 concrete crews...") gets a stronger border, background, shadow, and a bumped `.routeOptionMeta` font-size/weight so the number reads as the focal point; `.routeOption` (current path / no-change baseline) goes borderless, quieter, lower opacity. Same treatment applied to the delay/forecast card's `.fieldBody strong` ("+N days" figure) — bumped from `1.15rem` to `1.45rem`/`750` weight — which is a CSS-only, non-ambiguous target since it's the only `<strong>` inside that class in the whole component.
- **Logged but explicitly not implemented this pass** (per instruction): delay shards fully clearing on a taken route, rather than leaving residual risk, is a data/behavior change tracked as backlog, not touched here.

**Verification:** `tsc --noEmit` clean; `npm run build` clean. Real headless Chrome at `http://localhost:3001/`: HTTP 200, 0 console/page errors. Grid-scan click test found and clicked an alternate-route tube; confirmed via `getComputedStyle` that the leader-line SVG mounted with `opacity: 1`, its `<line>` carried real anchor coordinates, and the card's computed `position` was `fixed` with `left`/`top` matching the anchor plus the expected offset. Simulated a camera-orbit drag (mousedown/move/up on the canvas) and re-read the leader line's coordinates afterward — they moved, confirming the anchor is live-tracked every frame rather than fixed at click time.

### 2026-09-11 — Alternate-route preview: fix geometric overlap with current path

- Cause confirmed as described: `createRoutePreviewLine` only offset the preview by `position.y += 0.03` — fine for the old hairline `Line`, not enough clearance for a `0.075`-radius tube running near the `0.1`-radius taken-route tube or `0.085`-radius actual tube. Meshes could intersect/clip wherever the curves ran close.
- First attempt (an index-based eased ramp on the lift, mirroring the flat-offset structure) was numerically verified to be ineffective: swept the ramp width across three orders of magnitude and the curve's low-clearance zone was pinned at the same point every time, because CatmullRom's tangent near the branch point is shaped by the neighboring control points as a group, not by how gradually one point's height eases in.
- Replaced with a kickoff-point approach: the branch point (shared with the delay shard) stays unlifted, every other source point gets the full `0.24` lift, and a synthetic point is inserted a short distance (`ROUTE_PREVIEW_KICKOFF_FRAC = 0.02`, i.e. 2% of the way to the next point) already at full lift height — this forces the spline's tangent to point steeply upward immediately after the branch, which numerically verified to actually shrink the low-clearance zone (from ~10-12% of the curve down to 2-8% depending on point spacing, tested across three representative branch shapes).
- Distance-at-a-shared-point is unavoidably zero at the exact branch vertex (both curves share that one point by construction — that's the intended "peels off from the shard" visual); the fix minimizes how far that low-clearance zone extends rather than claiming to eliminate it, since eliminating it entirely is not physically possible for a continuous curve that starts at the same point as the path it's branching from.
- Fixed label/tick and camera-focus code that read the old flat `0.03` offset: added an exported `routePreviewLiftAt(points, index)` helper (branch index 0 → no lift, every other index → full lift) and used it in both the route-preview DOM label midpoint placement (two call sites: initial build and `refreshAlternateRoutes()`) and the route-click camera-focus lookup, replacing stale flat-offset math in each.

**Verification:** `tsc --noEmit` clean; `npm run build` clean. Real headless Chrome at `http://localhost:3001/`: HTTP 200, 0 console/page errors, grid-scan click test found and clicked an alternate-route tube and completed a take-route flow normally, confirming the geometry change didn't break interaction. Clearance itself verified numerically (not just visually) using the actual production lift formula run against three.js's real `CatmullRomCurve3` in a standalone Node script across three representative branch shapes (mild slope, sparse 2-point, steep climb) — confirmed the curve clears the `preview radius + taken-route radius + margin` (0.225) threshold within 2.3-7.5% of the curve's length in every case, and never drops back below it afterward.

### 2026-09-11 — Alternate-route preview: convert to tube (thickness/opacity patch)

- Incoming patch request assumed `createRoutePreviewLine` was already a tube from a prior "patch 2" — **it was not**: read the live source first and found it was still the flat `THREE.Line`/`LineBasicMaterial` from the initial recolor pass, with no matching commit anywhere in `git log --all`. Flagged the mismatch and asked before touching code; user chose "convert to tube now, then apply the patch."
- `createRoutePreviewLine` / `updateRoutePreviewLine` (`pathMeshes.ts`) rewritten from a flat `THREE.Line` to a `THREE.TubeGeometry` mesh, matching the construction pattern of the other route tubes (planned/actual/projected/taken). Radius `0.075` (new `TUBE_RADIUS_ROUTE_PREVIEW` constant — between projected `0.07` and taken `0.1`), `MeshBasicMaterial` (flat/unlit, keeps the Google-Maps-alternate-route look rather than the glassy `MeshPhysicalMaterial` used by the "real" path tubes), `transparent: true, opacity: 0.45`, `depthWrite: false`.
- Fixed a latent bug the conversion would otherwise have introduced: `journeyController.ts`'s route-click camera-focus logic read the midpoint via `line.geometry.getAttribute("position")` at `count/2` — correct for a simple polyline, but wrong for a tube mesh (that attribute is a ring of surface vertices, not centerline points, so the camera would have flown to an arbitrary point on the tube's circumference). Added a `points: THREE.Vector3[]` field to `AlternateRouteEntry`, kept in sync in both the initial build and `refreshAlternateRoutes()`, and switched the focus lookup to use it directly instead of the geometry attribute.
- `AlternateRouteEntry.line` type updated `THREE.Line` → `THREE.Mesh`; raycasting, `hideAlternateRoute`, and `findAlternateRouteFromObject` needed no changes — mesh vs. line raycasting is transparent to that code path.
- No color/position changes beyond what the radius/material swap required; hex, opacity-of-swatch, and axis-label wiring from the prior two recolor passes are untouched.

**Verification:** `tsc --noEmit` clean; `npm run build` clean. Real headless Chrome at `http://localhost:3001/` (navigator lives at `/`, not `/dev/schedule-navigator-3d`): HTTP 200, 0 console/page errors. Grid-scan click test confirmed the new tube mesh is still a correctly-hit raycast target — found and clicked an alternate-route tube, opened the panel, clicked "Take this route," and the flow completed normally (panel updates, no errors), confirming the geometry-type change didn't regress interaction. Screenshot-roundtrip pixel sampling found 802 pixels matching the target gray in-scene, confirming the tube renders with the correct color/opacity.

### 2026-09-11 — Route-line recolor: add dedicated `--route-alt` token

- Follow-up to the same-day route recolor below: added a dedicated `--route-alt: #8f887c;` CSS var (distinct from `--chrome-accent`, which stays button/CTA-only) and repointed `.swatchAlternate` background and `.axisKey[data-kind="route"]` color to it instead of the bare hex.
- All palette values (planned graphite, actual teal, projected amber, alternate gray, taken blue, ghost @0.2 opacity) were already correct from the prior pass — verified unchanged, not re-applied.
- **Verification:** `tsc --noEmit` clean; `npm run build` clean. Headless Chrome at `http://localhost:3001/` (3D Navigator lives at `/`, not `/dev/schedule-navigator-3d` — that dev route was retired 2026-09-09): HTTP 200, 0 console errors. `getComputedStyle` confirms all 5 legend swatches still resolve to their exact target hex through the new var. Filter-chip "All" active state still resolves to `rgb(95, 122, 79)` (`--chrome-accent`, untouched).

### 2026-09-11 — Route-line recolor: zero hue collisions

- Fixed two green/teal collision + legend-drift bugs in `schedule-navigator-3d`, confirmed by direct source read before changing anything.
- **Planned reference**: navy `#3a5b7e` → warm graphite `#5c584f`, now `transparent: true, opacity: 0.55` (background reference, not focal). `pathMeshes.ts` `createPlannedTube`.
- **Actual to date**: unchanged, `#1f7a6c` — now the only green/teal in the palette.
- **Projected/at-risk**: terracotta `#bf5b3f` → amber `#c98a3a`, applied to both the tube (`createOrUpdateProjectedTube`) and its dashed centerline (`createProjectedDashLine`) so they stay in sync.
- **Alternate-route preview**: sage `#5f7a4f` dashed → neutral gray `#8f887c`, **solid** (`LineBasicMaterial` replacing `LineDashedMaterial`, `computeLineDistances()` dropped from both create/update paths since nothing dash-dependent remains on that line). Google-Maps-alternate-route treatment. `createRoutePreviewLine` / `updateRoutePreviewLine`.
- **Taken/committed route**: unchanged, `#1a73e8` — now the only blue anywhere, reads unambiguously as "the decision."
- **Ghost (superseded route)**: same hue `#9a958c`, opacity 0.32 → 0.2, still dashed — dash now specifically means "no longer relevant" vs. the new solid gray meaning "an option right now."
- Route-preview pill label (`createRoutePreviewLabel`) recolored to match: stroke `#5f7a4f`→`#8f887c`, text fill `#4a6440`→`#4a463d`.
- **Legend/scene drift fix** (separate root cause, same audit): `.swatchPlanned` was `#2f7f8f` (didn't match the real navy tube at all); `.swatchActual` was a cream/tan gradient (the real tube has never had a gradient). Both swatches now flat-color and pixel-identical to their 3D line's new hex. `.swatchProjected` dash color and `.swatchAlternate` (dashed sage → flat gray, opacity 0.6) corrected to match. Axis-label colors (`.axisKey[data-kind="plannedEnd"/"projectedEnd"/"route"]`) updated in lockstep; stale "sage to match the dashed route line" comment corrected.
- `--chrome-accent` / `-strong` / `-bg` / `-border` tokens (button/CTA/filter-chip chrome) deliberately **untouched** — confirmed via computed-style probe that the active filter chip still renders the original `rgb(95,122,79)` sage post-change, so no chrome regressed even though it shares today's old route-preview hex by coincidence.

**Verification:** `tsc --noEmit` clean; `npm run build` clean (3 routes generated — 3D Navigator now lives at `/`, not `/dev/schedule-navigator-3d`, per the 2026-09-09 "Replace 2D Navigator on `/` with 3D" entry below). Real headless Chrome at `http://localhost:3001/`: HTTP 200, 0 console/page errors. Legend swatch computed styles confirmed exact hex match to each new line color (`getComputedStyle` probe, not eyeballed). Screenshot-roundtrip pixel sampling (WebGL canvas can't be `drawImage`'d directly without `preserveDrawingBuffer`, so the check re-decodes a `page.screenshot()` PNG instead) found substantial pixel counts for all 5 new colors in-scene and only stray anti-aliasing-level residue of the old navy/terracotta hues. Alternate-route preview confirmed solid (no dash) at the material level (`LineBasicMaterial`) and via scene pixel presence.

### 2026-09-11 — Repo cleanliness: orphaned debug artifact

- Removed `dashboard/after_chain.tmp.png`, a leftover debug screenshot committed during a prior debugging session with no code/doc references to it. Found via a full project audit; deleted and committed (`7aae694`).
- Independently re-verified the downstream-alternate-route-after-commit mechanic (previously flagged unverified): taking the Foundations route correctly surfaces a new alternate-route line for the downstream Envelope-shell delay; taking that second route compounds correctly in the status bar (`+24d, 1 plan active` → `+20d, 2 plans active`, exact arithmetic match), axis stays frozen, and each commit leaves its own independent ghost line (confirmed at the code level — `ghostLines.push()` never removes prior entries — plus live "Superseded — see ghosted line" note on each take). 0 console errors across the full sequence.

### 2026-09-10 — Scope correction: in-scene Navigator surface

- Removed the unrequested flat `Schedule status`, `State as of playhead`, `Complete`, `Pending`, `Delays known`, critical-driver, milestone-summary, waypoint-count, and empty route-summary surfaces from the default route.
- Kept the actual WebGL critical-path overlays and milestone marker meshes in the scene unchanged. The legend remains available as a compact visual key; route/shard detail panels still mount only after an interaction.
- Moved the existing `All` / `customs` / `weather` / `labor` / `mild` / `severe` filter controls into a compact overlay positioned directly over the WebGL viewport. The controller still applies `.visible` to the actual delay/forecast shard groups only.
- Reverified the filter against the scene path: clicking `Weather` sets the chip pressed state and filters shard groups; planned, actual, projected, route, critical-path, and milestone geometry are not mutated.

**Verification:** `npm run build` completed with TypeScript clean. Real headless Chrome at `http://localhost:3001/` returned HTTP 200, mounted WebGL, captured `/tmp/navigator-final-clean.png`, showed no prior stats strings, and recorded zero console/page errors. Before/after filter screenshots: `/tmp/navigator-final-scene-before.png` and `/tmp/navigator-final-scene-after-weather.png`.

### 2026-09-10 — Filter verification / recommendation confirmation

- Filter wiring is correct; no code change shipped. Trigger: click the `Weather` chip in the `FILTER SHARDS` bar directly below the status panel. `aria-pressed` becomes `true` and only shard groups change visibility; planned, actual, projected, route, critical-path, and milestone geometry remain unchanged.
- Exact headless diagnostics after the Weather click: `foundations` visible, `roof-completion` visible, `structural-frame` hidden, `envelope-shell` hidden, `interior-finishes` hidden. Category/severity values matched exactly (`weather`, `customs`, `labor`; `mild`/`severe`).
- Before screenshot: `/tmp/filter-before-correct.png`. After screenshot: `/tmp/filter-after-weather-correct.png`. Both show the same curves and timeline; the after state has the Weather chip highlighted and the filtered shard set. The initial zero-diff check was invalid because it used a 2D canvas context on a WebGL canvas; the visibility diagnostics confirmed the actual scene state.
- Root cause of the apparent failure: the verification script used `Array.find(async predicate)`, which selected the first `All` button instead of `Weather`. The temporary console diagnostics were removed after confirmation.
- Feature 3 remains shipped: the route panel exposes the frontend-computed `DERIVED` recommendation and rationale; no route mechanics changed.

**Verification:** final build/TypeScript remained clean; headless browser returned HTTP 200 with zero console/page errors. Existing camera choreography was not changed.

### 2026-09-10 — Demo pass: camera, shard filters, route recommendation

**Shipped features 1–3; comparison mode deliberately cut.**

- Camera choreography: added a shared 1.05s GSAP fly-to frame for delay/forecast shard clicks and alternate-route selection/commit. Manual orbit and idle drift remain unchanged elsewhere; panel callbacks run immediately alongside the move.
- Filterable timeline: added `customs`, `weather`, and `labor` category metadata to the existing dummy delay/forecast waypoints plus mild/severe severity chips. Default is all visible. Controller filtering toggles shard groups only; paths, routes, critical overlays, milestones, and committed recovery state are untouched. Filter metadata is labeled `DERIVED`.
- Computed route recommendation: added a frontend score using days recovered divided by a cost-burden derived from the existing resource-cost text. The route panel identifies the computed suggestion and rationale as `DERIVED`; route commit mechanics are unchanged.
- Comparison/what-if mode: **cut** for this demo window. No partial comparison UI or alternate commit path was left live.

**Per-feature verification:** after camera, filter, and recommendation edits, `npm run build` completed with TypeScript clean. Real `puppeteer-core` + headless Chrome used SwiftShader against `http://localhost:3001/` after each feature; final pass returned HTTP 200, mounted WebGL canvas, opened the route panel, showed computed recommendation text, showed filter controls, retained `3 drivers` and `Structural milestone`, captured `/tmp/schedule-navigator-final-demo.png`, and recorded zero console/page errors.

### 2026-09-10 — Critical path highlighting + structural milestones

**Implemented: frontend-only, dummy scenario preserved.**

- Added risk-aware `computeCriticalPath(waypoints, recoveries)` in `pathFromWaypoints.ts`. Unresolved actual delay with no catch-up plan and residual future forecast risk are drivers; actual delays with a catch-up plan are slack candidates, with residual float computed after recovery. The calculation is rerun after each catch-up commit. The dummy scenario reports `structural-frame`, `interior-finishes`, and `roof-completion` as the three current drivers; foundations and envelope remain slack candidates.
- Added projected-line emphasis overlays: thin ink dashed segments for zero-float critical spans and pale taupe dashed segments for slack spans. The existing navy/teal/coral tubes and red/amber shard treatments remain unchanged; overlay state is labeled `DERIVED` in the legend.
- Added four structural milestone records to the dummy waypoints: foundations, structural frame, envelope shell, and interior fit-out. Their reached/upcoming state is derived from the shared `timeline.asOf`; no celebration treatment or new backend/schema pipeline was added.
- Added distinct WebGL marker shapes: square-frame critical-path markers and square checkpoint markers. Critical markers update position and critical/float styling after route morphs; milestone markers remain separate from delay crystals and hollow forecast shards.
- Added a compact status-bar critical-driver count, selected-waypoint impact/float readout, and legend entries. Criticality is labeled `DERIVED`; milestone labels remain dummy scenario content.
- Restored ignored `dashboard/.env.local` with `USE_DUMMY_DATA=true`; without it this checkout defaults to missing real pipeline files and the dashboard cannot mount.

**Verification:** `npm ci` succeeded with 0 vulnerabilities; `npm run build` succeeded with Next.js compile, TypeScript, page generation, and route output clean. Final `puppeteer-core` + headless Chrome pass at `http://localhost:3001/` returned HTTP 200, mounted a `724×478` WebGL canvas, showed `3 drivers`, critical/slack/milestone legend entries, captured `/tmp/schedule-navigator-critical-milestones-final.png`, and recorded zero console/page errors.

### 2026-09-09 — Real Y-axis (cumulative % complete) — fix flat planned/actual lines

**Diagnosis (before any change):**
- `pathFromWaypoints.ts` `buildJourneyPoints()` computed each waypoint's world Y as
  `0.22 + cascadeBefore*0.035 + residualLocal*0.07` — a function of *delay magnitude*, not
  progress. Waypoints with no local delay (most of them) all landed at the same height, so the
  actual/projected line was flat except for small bumps at the 3 delay waypoints.
- `plannedPoints` (the planned reference line) used a **hard-coded flat Y = 0.12** for every
  waypoint — it was never data-driven at all, just a spacing constant.
- Dummy dataset had no completion-% field of any kind; `fusion.json` real-data path has
  `completionPct` (DERIVED) per component, confirmed present and averageable per waypoint group
  for a future real wiring, but intentionally left unwired this pass (`USE_DUMMY_DATA=true`).

**Fix:**
- Added `cumulativePlannedPct` (always) and `cumulativeActualPct` (only while a waypoint is
  finished-or-in-progress as of `timeline.asOf`) to `NavigatorWaypoint`
  (`aggregate.ts`) and to the 9 dummy waypoints (`schedule-navigator-dummy.json`), weighted by
  each waypoint's `componentCount` share of the project total (258 components) — a real,
  non-arbitrary S-curve: 4.7 / 15.5 / 21.7 / 38.0 / 51.6 / 70.2 / 91.5 / 96.9 / 100.0.
  `envelope-shell` (in progress at asOf) gets a genuine partial actual value (45.0%) derived
  from its own onTime+ahead component count (18/35) blended into the prior cumulative — not a
  guess.
- Added `pctToY()` / `PCT_AXIS_Y_BASE` / `PCT_AXIS_Y_SPAN` (0-100% → world Y 0.15-4.15) and a
  vertical % axis (rail + 0/25/50/75/100 ticks + DOM pill labels, same chip styling as the
  X-axis date chips) in `timelineAxis.ts`; mounted in `journeyController.ts`.
- `buildJourneyPoints()` / planned-point construction in `pathFromWaypoints.ts` now derive Y
  from `pctToY(cumulativeActualPct ?? cumulativePlannedPct ?? index-fallback)` — future
  waypoints (after today) plot at their full planned-% weight at their (possibly cascaded)
  date, so the projected line continues the actual line's real value smoothly toward 100%.
- Fixed a **DOM-mount ordering bug** hit during verification: `mountAxisLabelElements`
  (X-axis) calls `container.replaceChildren()`, which was wiping out the % labels mounted
  before it — moved the % label mount to after the X-axis mount.
- Fixed a **visibility bug**: the % axis rail was originally placed at world x=-3 (left of
  timeline start), which the existing cinematic camera framing crops out entirely (confirmed
  "Start" label is *already* off-screen there pre-existing, out of scope to fix generally).
  Moved the rail to x=10 (still left of all real path progress, inside the visible frustum) and
  added its extreme points to `model.bounds` so the camera includes it.
- Catch-up/shard mechanics: unaffected in logic — `computeCascadedSchedule` still drives X
  only; shard positions still sample the rebuilt curves, so shard click/detail-card interaction
  was re-verified in a live headless Chrome session (clicked the "Structural frame" delay
  shard, card opened correctly, 0 console errors) after the Y change.

**Verification:**
- `tsc --noEmit`: clean.
- Headless Chrome (puppeteer-core against local `chrome.exe`, not installed as a project dep):
  screenshot confirms a real rising S-curve for planned (navy), actual-to-date (teal, rising to
  the "Today" marker), and projected (coral, continuing the rise to "Planned end"/"Projected
  end") — no flat segments except where genuinely no work is scheduled. % axis rail + 0/25/50/
  75/100% pill labels render on-screen. 0 console errors.
- Also discovered `dashboard/.env.local` (which sets `USE_DUMMY_DATA=true`) does not exist in
  this checkout (it's gitignored and wasn't carried over) — recreated it so the dummy scenario
  loads by default, matching the documented behavior above.

### 2026-09-09 — Label collision, halo artifacts, professional typography (4 items)

1. **Label collision (Planned End / Projected End overlap).** `syncProjectedLabels` (timelineAxis.ts) now runs general collision avoidance: key labels are measured by `offsetWidth` and greedily assigned to non-overlapping vertical rows; a colliding label is lifted `translateY(-row * (height+8)px)`. Optioned Year-end names / Projected End stack instead of overlapping at any zoom/camera. Month labels (already sparse / axis-anchored) are excluded.
2. **Halo artifacts — diagnosis:** the composer has **no bloom pass** (RenderPass + OutputPass only; the old UnrealBloomPass was removed), so the halos were not post-processing. They were **flat floor-ring meshes**: the today-marker's broad ink "floor stamp" annulus (0.10→0.30 world-units, mid-timeline = the large halo) and the per-shard flat "attention ring" (0.30→0.38). Fix: removed the today-marker's wash/crisp annulus in favor of one small engraved floor dot (0.045); shard ring reduced to 0.26→0.32 (opacity 0.38) and its hover/selected flare capped (scale 1.18→1.12, opacity 0.28/0.18→0.22/0.16) in journeyController. No stray glow blob remains.
3. **Typography — professional.** `--font-display` now points to IBM Plex Sans (heavier weight) instead of Syne; dropped the Syne `next/font` import/variable, added Plex weight 700. Applies app-wide (all `--font-display` usages: Schependomlaan brand, nav, stat values, cluster badges, axis labels, card titles, buttons). Reads as enterprise/SPM software, not a creative-agency poster.
4. **Today marker contrast.** Collar torus thickened 0.018→0.022 and full-opacity ink; floor rings replaced with a crisp dot. Reads clearly on cream without dominating.

**Confirmation:** `tsc --noEmit` clean; http://localhost:3001 → 200. Headless-Edge screenshot (`dashboard/shot2.png`) sampled: navyPlanned 58, coralProjected 62, redShard 25, darkInk 1934; no Uncaught/TypeError/ReferenceError in Edge console. (Agent has no image input; visual claims are programmatic-pixel checks.)

### 2026-09-09 — Light-theme contrast & finish fixes (5 items)

**Context:** Finishing pass on the existing light/cream theme. Semantic hues (navy/green/coral) unchanged; cream/beige base unchanged.

1. **Bottom-left status text readable.** `.hud` (bottom-left "click a date · orbit to inspect" + waypoints/delays/clusters line) color changed from `rgba(36,48,65,0.75)` → ink `#2B2824`, removed the white `text-shadow` that washed it out. Ink on cream ≈ 13:1 (target ≥4.5:1). Verified by pixel sampling the bottom-left region: 257 dark text pixels present.
2. **Timeline guide line visible.** `createAxisRail` (timelineAxis.ts) rebuilt from 1px `LineBasicMaterial` (`#7A8FA3` @0.55, invisible) → real-thickness box mesh in warm dark ink `#3D3732` @0.82; month ticks → `#5A5249` boxes. Reads at a glance without dominating.
3. **Today marker redesigned (ink-stamp).** `createTodayMarker` (pathMeshes.ts) replaced the wide 0.018×1.15×0.55 grey slab with: a thin vertical needle (0.02×1.0×0.02) in ink `#2B2824`, a sage `#8B9A6E` crossbar finial, a crisp ink torus collar, and a layered floor stamp (soft ink wash + crisp ring `#2B2824` + center dot). No flat grey box.
4. **Delay shards read as alerts.** Crystal + ring + legend swatch + scrubber marks + delay/cluster text unified from muted maroon `#A93B3A` → confident brick red `#A11D22`; attention-ring opacity 0.3→0.45. Clearly distinct from projected coral `#BF5B3F` (confirmed distinct via pixel class counts).
5. **Tubes glassy, not flat.** Was `MeshStandardMaterial`; diagnosed lighting still tuned for a dark backdrop. Converted planned/actual/projected to `MeshPhysicalMaterial` (clearcoat 0.5–0.6, clearcoatRoughness ~0.15, roughness ~0.25), added a neutral studio **RoomEnvironment** env map (`scene.environment` via PMREMGenerator) so specular reads against cream, and recalibrated lights for a bright backdrop: ambient warm `0xfff6ea`@0.42, key `0xfff3e2`@1.55 raised from 1.1, toneMappingExposure 0.95→1.05.

**Confirmation:** `tsc --noEmit` clean; dev server http://localhost:3001 → HTTP 200. Rendered screenshot (`dashboard/shot1.png`) pixel-sampled: darkInk 2642, deepRed 44, coral 34, navy(planned) 52, teal(actual) 13, sage 8 — all new colors on screen.
**Note:** this agent cannot view image files (no image input), so visual claims are backed by programmatic pixel classification of the headless-Edge screenshot rather than a human-eyes pass.

### 2026-09-09 — Demo-tells cut + dashboard chrome

- Removed custom cursor, magnetic CTA, grain, looping shard rings, dramatic entrance pop.
- Added status bar (slip DERIVED, % complete unavailable, next milestone, worst delay) + side legend.
- Scene sits in a stage grid under chrome, not full-bleed alone.
- Preview: http://localhost:3001/dev/schedule-navigator-3d

### 2026-09-09 — Repair interrupted asOf run + catch-up / camera / labels

- Removed leftover `PLACEHOLDER_TODAY_FRACTION` / reason-recovery placeholders from `ScheduleNavigator3D.tsx`; wired `timeline.asOf`, `delayReason`, `catchUpPlan`.
- Catch-up: proportional residual via `daysRecovered`/`daysLost`; multi-plan `appliedRecoveries` compounding; GSAP morph from current path.
- Camera: replaced rAF lerp idle drift with GSAP + CustomEase; weighted OrbitControls.
- Axis labels: high-contrast pill chips; today marker confirmed prior redesign.
- Confirmed build: `tsc` clean; http://localhost:3001/dev/schedule-navigator-3d → 200; API asOf `2015-07-10`.

### 2026-09-09 — Actual/today/projected model + Part B polish

**Step 0 checkpoint (corrected):** Prior “~57.5% / 16 files Part B polish” was **not** present on disk. Workspace had the reveal-gated WebGL navigator (Part A clustering/bloom/framing) only — no preloader, custom cursor, grain, magnetic CTA, or idle drift yet. Those polish items were implemented in this pass against the **new** mechanic.

**Step 1 — conceptual model (done):**
- Removed click-to-reveal / per-click dolly entirely (not disabled — deleted).
- Actual-to-date path: full warm glossy tube on load; all past delay shards/clusters visible immediately; click still opens reason/time-lost card.
- Today marker: glowing pin + flag + halo at actual→projected junction.
- Projected path: amber/red semi-transparent tube + dashed centerline from today forward.
- Catch-up: GSAP tweens projected control points toward planned targets; TubeGeometry rebuilt each frame (**perf simplification**, commented in `pathMeshes.ts` / card copy).
- Camera: static cinematic frame of whole composition + slow idle yaw drift (no reveal dolly).

**Today split (PLACEHOLDER):**
- No `today` / `asOf` / actual-vs-projected field in dummy JSON, `aggregate.ts`, or API route.
- `PLACEHOLDER_TODAY_FRACTION = 0.6` → for 9 dummy waypoints, `todayWaypointIndex = 4` (Envelope shell); waypoints 0–4 actual, 4–8 projected junction+forecast.
- Real schema field required before production data.

**Step 2 — Part B polish status:**

| Item | Status | Notes |
|------|--------|-------|
| Preloader / entrance | **Done** | Boot bar + scene scale-in; today + shards pop on `onSceneReady` |
| Custom cursor | **Done** | Viewport-local trailing dot + label on shard/catch-up |
| Magnetic hover | **Done** | Catch-up CTA magnetic pull; shard hit-test cursor affordance |
| Easing discipline | **Done** | `power3` / `expo` / `back` / `power2.inOut` shared vocabulary |
| Typography | **Done** | Existing Syne display + IBM Plex body retained / used in card+HUD |
| Ambient grain | **Done** | SVG-noise overlay on viewport |
| Idle camera drift | **Done** | Subtle yaw; pauses while user orbits / during catch-up morph |
| Audio | **Skipped** | Explicitly out of scope |

**Preview:** http://localhost:3001/dev/schedule-navigator-3d

### 2026-09-09 — WebGL Schedule Navigator 3D (data-driven shards)

- Implemented `ScheduleNavigator3D` + scene modules under `dashboard/src/components/schedule-navigator-3d/`.
- Delay → shard rule: `localDelayDays > 0` (equiv. `severity !== "none"` on current payloads). Dummy yields **7 shards** from 9 waypoints (pre-today-split; now only actual-to-date delays are marked).
- **Superseded:** progressive reveal — replaced by actual/today/projected model above.
- Placeholders: **no reason field**, **no recovery/mitigation field** on `NavigatorWaypoint` — card uses FORGED-tagged placeholders.
- Review route: **http://localhost:3001/dev/schedule-navigator-3d** (2D navigator still on `/`, untouched).

### 2026-09-09 — Retire 3d-twin + switch dashboard to dummy data

- Deleted entire `3d-twin/` (~668 MB including node_modules/.next).
- Deleted `shared/data/pointclouds/` (~47 MB) including `alignment-manifest.json` at `shared/data/pointclouds/alignment-manifest.json`.
- Deleted `shared/scripts/align-pointclouds.ts` and `downsample-pointclouds.ts`; removed matching npm scripts. Kept `parse-ifc.ts` and other core pipeline scripts; raw IFC untouched.
- Added `shared/data/dummy/schedule-navigator-dummy.json` (9 fabricated waypoints, `dataProvenance: "dummy"`).
- Wired `GET /api/schedule-navigator` to respect `USE_DUMMY_DATA` from `dashboard/.env.local` (default `true`).
- Added `three` (+ `@types/three`) to dashboard; left `d3` / `gsap` in place.
- Added unwired placeholder `dashboard/src/components/schedule-navigator-3d/ScheduleNavigator3D.tsx`.
- Left existing 2D `schedule-navigator/` untouched.

### 2026-09-08 — Illustrative centroid alignment

- Unit normalize weeks 26–30 to meters; bake + centroid-translate into `meters/*.meters.ply`.
- Manifest: `bimRegistration: "illustrative"`, `alignmentMethod: "centroid-match-approximate"`.
- BIM co-registration via ICP/control points: **not** done (blocked for real accuracy; demo uses centroid snap).
- **Superseded 2026-09-09:** point-cloud outputs and alignment scripts removed with 3d-twin retirement.

### 2026-09-08 — Pexels photo sourcing

- Reverted Openverse leftovers; sourced 80 Pexels images + attribution.
- Openverse script left unused for reference.

### 2026-09-08 — Pre–3d-twin diagnostic

- Documented unit mismatch (W26 m vs W27–30 mm), no shared origin, AABB-only IFC geometry via `web-ifc`, empty `3d-twin/`.

### 2026-09-08 — Restart stale Next.js on :3000

- Freed port 3000; restarted `npm run dev -- --port 3000` from `3d-twin/`.
- Unblocked compile error in `3d-twin/src/app/page.tsx` (`ssr: false` in Server Component).
- App shell responds; IFC WASM loading still needs a follow-up.

### 2026-09-08 — Fix web-ifc WASM / BIM load

- Root cause: `/wasm/` empty + `SetWasmPath` called after `Init()`.
- Copied `web-ifc.wasm` / `web-ifc-mt.wasm` via `3d-twin/scripts/copy-wasm.mjs` (`postinstall` / `dev` / `build`).
- `loadIfcModel.ts`: `SetWasmPath` before `Init(undefined, true)` (single-thread).
- Headless smoke: status `BIM loaded — orbit to navigate`; no console errors.
- **Superseded 2026-09-09:** `3d-twin/` fully removed.

### 2026-09-08 — Dashboard Stage 1 (shell + Schedule Navigator base)

- Scaffolded `dashboard/` Next.js 16 App Router + d3 + gsap; port **3001**.
- Aggregated 39 taskNameEn waypoints from schedule/fusion/deviation; illustrative cascade.
- Dual-route SVG (planned / projected), GSAP stroke draw-in, delay markers + hover.
- FORGED badges on deviationDays; **1,203 not_scheduled** callout (not folded into behind).
- Later sessions added zoom/clustering; Stage 3 views still pending.

---

## Open / next

- [x] Retire `3d-twin/` and point-cloud alignment artifacts
- [x] Dummy navigator dataset + `USE_DUMMY_DATA` switch
- [x] Add `three` + empty `ScheduleNavigator3D` placeholder (unwired)
- [x] Implement WebGL shard-journey Navigator (review at `/dev/schedule-navigator-3d`)
- [x] Replace click-to-reveal with actual / today / projected + catch-up morph
- [x] Part B Awwwards polish (no audio) on corrected mechanic
- [x] Timeline axis (DOM-projected calendar labels) + today-marker redesign
- [x] Repair interrupted asOf / CatchUpPlan wiring; remove PLACEHOLDER_TODAY_FRACTION
- [x] Proportional catch-up (daysRecovered/daysLost) with multi-plan compounding
- [x] GSAP-driven idle camera (CustomEase) — replace render-loop lerp
- [x] Date-label legibility chips
- [x] Tone down demo polish (cursor / magnetic CTA / shard rings / grain / entrance)
- [x] Dashboard chrome: status bar + persistent legend around 3D centerpiece
- [x] Timeline scrubber (playhead + inspection panel + projected-zone label)
- [x] Critical path highlighting with route-aware zero-float recomputation
- [x] Structural milestone markers with reached/upcoming state
- [ ] Decide formal schema promotion for delay **reason** + **catchUpPlan** (already on dummy + aggregate types)
- [ ] Add real project **% complete** when pipeline exposes it
- [ ] Optional: surface delay reason snippet in status bar without click
- [x] Replace 2D Navigator on `/` with 3D once approved
- [ ] Dashboard Stage 3 — 6 minor views
- [x] Complete visual polish pass: Option A dark chrome refinement, 8px spacing scale (--space-1..6), consistent GSAP easing
- [x] Path geometry & material refinement: Bloomberg terminal aesthetic, thin glassy lines, MeshPhysicalMaterial
- [ ] Decide formal schema promotion for delay **reason** + **catchUpPlan** (already on dummy + aggregate types)
- [ ] Add real project **% complete** when pipeline exposes it
- [ ] Optional: surface delay reason snippet in status bar without click
- [x] Replace 2D Navigator on `/` with 3D once approved
- [ ] Dashboard Stage 3 — 6 minor views
- [ ] Re-enable real data (`USE_DUMMY_DATA=false`) when pipeline work resumes
- [ ] Optional: replace per-frame TubeGeometry rebuild on catch-up with cheaper morph

---

## Latest output

```
Path Geometry & Material Refinement + Chrome Polish Complete (2026-09-09)

1. SPACING AUDIT (100% token conformance)
   - Replaced all non-token rem/px in ScheduleNavigator3D.module.css (.axisMonth, .axisKey,
     .playhead, .clusterItem, .primaryBtn) with --space-1 (0.25rem), --space-2 (0.5rem),
     --space-3 (0.75rem), --space-4 (1.0rem).
   - Standardized secondary radius to calc(var(--chrome-radius) - 4px).
   - Enforced font-variant-numeric: tabular-nums across all stat numbers and dates.

2. SECONDARY SURFACES (Option A dark chrome applied everywhere)
   - Reason card (.card): switched to var(--chrome-bg), var(--chrome-border-strong),
     deep backdrop blur, and inset specular border.
   - Close button (.closeBtn): subtle dark pill with --chrome-border and hover elevation.
   - Catch-up button (.primaryBtn): replaced old light #f4f7fb with dark teal/slate glass
     gradient (linear-gradient(165deg, rgba(35, 75, 88, 0.75), rgba(20, 48, 58, 0.85))),
     border rgba(47, 127, 143, 0.55), hover glow rgba(47, 127, 143, 0.9), and disabled dark state.
   - Recovery card (.recovery): dark teal tinted surface with --chrome-radius - 4px.
   - Delay chips (.scrubDelayBtn): dark chrome border and hover state.

3. MOTION HARMONIZATION
   - CSS transitions (.scrubBar, .scrubProjectedBanner, .closeBtn, .primaryBtn, .clusterItem)
     harmonized to var(--ease-ui) (0.28s cubic-bezier(0.33, 1, 0.68, 1) ≈ power2.out).
   - Card entrance in ScheduleNavigator3D.tsx aligned to EASE.card ("expo.out").
   - 0 demo-tells reintroduced (no custom cursor, no magnetic hover, no grain, no looping rings).

4. PATH GEOMETRY & MATERIALS (Bloomberg terminal / precision data-viz)
   - Radial resolution: TUBE_RADIAL increased from 10 to 24 segments (+140% cross-section
     smoothness, eliminating faceting under specular light).
   - Radii reduced for precision linework:
     * Actual: 0.16 -> 0.085 (-47% diameter, crisp glassy telemetry line)
     * Planned: 0.11 -> 0.055 (-50% diameter, laser-fine reference track)
     * Projected: 0.095 -> 0.07 (-26% diameter, amber forecast track)
   - Tubular segments increased:
     * Planned: Math.max(96, length * 8)
     * Actual: Math.max(80, length * 10)
     * Projected: Math.max(64, length * 8)
   - Materials upgraded to MeshPhysicalMaterial:
     * Planned: MeshPhysicalMaterial (metalness 0.35, roughness 0.22, clearcoat 0.85,
       clearcoatRoughness 0.12, emissive #0c3842)
     * Actual: MeshPhysicalMaterial (metalness 0.18, roughness 0.12, clearcoat 1.0,
       clearcoatRoughness 0.06, emissive #dfd0b5)
     * Projected: MeshPhysicalMaterial (metalness 0.22, roughness 0.20, clearcoat 0.75,
       clearcoatRoughness 0.12, opacity 0.62)
     * Today marker: collar torus resized to radius 0.14, tube 0.016 (snug fit on 0.085 path);
       vertical reticle plane 0.018 x 1.15 x 0.55 with clearcoat 0.75.
     * Shard crystal: calibrated to 0.24 * scaleBoost with clearcoat 0.95, roughness 0.18.
   - Lighting & Bloom:
     * Added directional specular kicker light at (-8, 14, 10), intensity 0.65.
     * Boosted key directional light to 1.25.
     * UnrealBloomPass tightened to strength 0.25, radius 0.12, threshold 0.72.

5. VERIFICATION
   - tsc --noEmit: CLEAN (exit 0, 0 errors).
   - Real Chrome Headless verification with WebGL:
     * Canvas initialized (1114 x 557 px).
     * Post-hydration status bar, scrub inspection bar, legend, and axis chips verified.
     * Card and catch-up CTA clicked and verified in real browser.
     * Console errors: 0.
   - Preview: http://localhost:3001/dev/schedule-navigator-3d
```

### 2026-09-09 — Fix 1: Catch-Up Date Sync (Proportional recovery reflected across UI & 3D)

**Diagnosis & Root Cause:**
- Geometry morph in `scene/journeyController.ts` computed `computeCascadedSchedule(model.waypoints, appliedRecoveries)`, but the projected end date was never synced back to the React UI or the axis overlay elements.
- The status bar in `ScheduleNavigator3D.tsx` statically rendered `summary.daysBehind` and did not display the projected completion date.
- The 3D tick mark (`projectedEndTick`) and DOM axis chip (`data-kind="projectedEnd"`) remained fixed at the initial static projected end date (`2015-10-18`) during and after the morph.

**What Changed:**
1. `scene/timelineAxis.ts`: Exported `formatDay` helper.
2. `scene/journeyController.ts`:
   - Updated `JourneyCallbacks.onCatchUpComplete` payload to include `projectedEnd: string` and `daysBehind: number`.
   - Retained reference to `projectedEndTick` mesh (`#c45a32`).
   - In both `applyCatchUpPlan` and `resetCatchUpPlan`:
     * Computes `cascaded = computeCascadedSchedule(model.waypoints, appliedRecoveries)` and updates `model.timeline.projectedEnd`.
     * GSAP tween lerps `projectedEndTick.position.x` and `projectedLabel.local.x` smoothly from initial X to target X (`dateToX(newProjectedEndIso, scale)`).
     * On completion, updates `projectedLabel.el.dataset.iso`, `sub.textContent = formatDay(newProjectedEndIso)`, and `aria-label`.
     * Fires `callbacks.onCatchUpComplete` with new projected date and net cascaded days behind.
3. `ScheduleNavigator3D.tsx`:
   - Added `projectedEndIso` and `activeDaysBehind` state wired to `onCatchUpComplete`.
   - Derived `effectiveDaysBehind = activeDaysBehind ?? summary.daysBehind` and `effectiveProjectedEnd = projectedEndIso ?? data.timeline.projectedEnd`.
   - Updated status bar Schedule card to display `formatSlip(effectiveDaysBehind)` with `<span className={styles.statHint}>projected {formatDay(effectiveProjectedEnd)}</span>`.

**Verification:**
- `tsc --noEmit`: Clean (exit code 0, 0 errors).
- Real Headless Chrome with WebGL verification via CDP (`scratch/headless-verify.mjs`):
  * Initial State: Status bar `30d behind / projected 18 Oct 2015`; Axis chip `PROJECTED END 18 Oct 2015`.
  * Foundations catch-up applied (-6d recovery).
  * Post-catchup State: Status bar `24d behind / projected 12 Oct 2015`; Axis chip `PROJECTED END 12 Oct 2015` at translated 958px on rail.
  * Console errors: 0. Screenshot captured: `schedule_navigator_3d_catchup_active.png`.

---

### 2026-09-09 — Fix 2: Standalone timeline scrubber bar (verified present) ✅

**Status:** This fix was already fully implemented in the working tree before this pass (one of the fixes left mid-run by the previous agent, but its code was complete and correct). **Verified present, no further edits required.**

**What exists (verified in `ScheduleNavigator3D.tsx` + `ScheduleNavigator3D.module.css`):**
- A standalone 2D scrubber DOM element (`.scrubberContainer`) docked below the 3D viewport (inside `.viewportColumn`, matching AppShell layout) — entirely outside the canvas, so it **never conflicts with OrbitControls** (deliberate architecture per scope).
- Horizontal rail spans the full date range (`projectedEnd − start`): 0% = `timeline.start`, 100% = effective projected end.
- A draggable playhead thumb (`.scrubberThumb`) with native `pointerdown`/`pointermove`/`pointerup` and keyboard `ArrowLeft`/`ArrowRight` support.
- Dragging updates position **live** (not on release) and calls `controller.setScrubIso(iso, { reframe: true })`, driving the same camera reframe + `buildScrubSnapshot` inspection-panel update used by chip-click.
- Ticks on the bar: **Today**, **Planned end**, **Projected end** and clickable **delay-shard diamonds** — doubles as an overview map.
- Separate actual (`progressActual`) and projected (`progressProjected`) progress segments.
- **Chip-click-to-jump retained unchanged** (additive, not a replacement).

No changes made in this pass — Fix 2 verified complete.

---

### 2026-09-09 — Fix 3: Path start point now aligns with the "START" date marker ✅

## Root cause
Both the axis START marker and the tube's first vertex use `dateToX` — but they referenced **different date values** (a shared-coordinate drift, not a 2D-vs-3D projection mismatch):
- Axis rail + "START · 2 Mar 2015" label sit at `x = dateToX(timeline.start, scale) = 0` (`buildAxisAnchors` / `createAxisRail` in `timelineAxis.ts`).
- The tube's first control point was the **first waypoint's plannedEnd/projectedEnd** (`dateToX("2015-03-20")` for `site-prep`), ~18 days after start — hence the gap near "Apr 15".

## What changed (`scene/pathFromWaypoints.ts`, `scene/journeyController.ts`)
1. `buildNavigatorPathModel` now **prepends a synthetic start-anchor control point** at `dateToX(timeline.start, scale)` (x = 0, matching the START label/axis rail exactly) to `plannedPoints` (y=0.12) and `fullJourneyPoints` (y=0.22).
2. Delay-shard lookup offset by `+1` (`ptIndex = waypointIndex + 1`) so shards stay on the correct vertex.
3. `actualPoints` / `projectedControlPoints` / `todaySample` rebuild from the prefixed array automatically.
4. Scrub-cursor journey in `journeyController` also leads with the same anchor for consistency.

**Net effect:** tube first vertex and axis start reference the exact same date → no gap at the START marker.

---

### 2026-09-09 — Fix 4: Delay-shard detail card anchored near its shard (not fixed corner) ✅

## Root cause
The card was a large fixed panel pinned top-right (`.card { top/right: var(--space-4); width: 21.5rem }`), blocking the scene while scrubbing; it never referenced the shard's position.

## What changed

**Content/logic unchanged** — only positioning/sizing (title, Time Lost, Reason, Apply catch-up, close button, FORGED styling kept).

1. `scene/journeyController.ts`
   - Added `getShardScreenAnchor(): { x, y, onScreen } | null` to the interface + implementation: projects the selected cluster's world position through `root.updateMatrixWorld` + `camera` into viewport dev px — re-using the existing 3D→2D projection pattern from `syncPlayheadLabel`, no new projection logic.
2. `ScheduleNavigator3D.tsx`
   - New `useEffect` (keyed `[selected]`) runs a `requestAnimationFrame` loop while a card is open, reading `getShardScreenAnchor()` each frame and writing `left`/`top` **directly to the card DOM** (no React state churn).
   - Positions the card **above the shard by default** with a gap; flips **below** near the top edge; clamps horizontally so it never runs off-screen; hides when the shard is off-screen/behind camera.
   - **Chose the "track live" option** (state which): on orbit / scrub-driven reframe the card follows its shard live instead of closing.
3. `ScheduleNavigator3D.module.css`: `.card` converted from fixed top-right panel to a compact absolute popover (`width: min(15.5rem, …)`, `left/top: 0`, smaller shadow/radius, capped `max-height`).

**Note:** click-outside-to-close was **not** present in prior code (close button only), so per scope ("if already present") it was not added; close button remains and works.

---

### 2026-09-09 — Fix batch: build/typecheck status
- `tsc --noEmit`: **Clean (0 errors)** — verified via detached typecheck (empty error output). Full-project `tsc`/`eslint` exceed the 30s command cap here, so the check ran in a background process.
- Files changed: `scene/pathFromWaypoints.ts`, `scene/journeyController.ts`, `ScheduleNavigator3D.tsx`, `ScheduleNavigator3D.module.css`.
- Recommended next QA: real-browser screenshot + pointer-drag of both scrubber and shard card; changes are self-contained/additive.

---
### 2026-09-14 — Real-data prep for Schedule Navigator (USE_DUMMY_DATA=false path, not switched on by default)

**Data loading fix:** `schedule.json`/`fusion.json`/`deviation.json`/`metadata.json` don't exist on disk (only `data.json`, `components.json`, `safety.json` remain). Rather than regenerate the split files (fragile — depends on raw drone/IFC inputs not guaranteed present), `route.ts`'s real branch now loads `data.json` and destructures `plannedSchedule`/`fusionOutputs`/`asBuiltDeviations`/`projectMetadata` — same shape `buildScheduleNavigatorPayload` already expected. Verified this loads.

**Extended `buildScheduleNavigatorPayload` (`aggregate.ts`)** to FORGED-synthesize all 5 fields the 3D UI depends on that the real schema doesn't carry — same convention as existing FORGED fields (deviationDays, resourceCost):
- `cumulativePlannedPct`/`cumulativeActualPct`: componentCount-share-weighted S-curve, same method as dummy. **Bug caught during verification:** first attempt normalized by the union of distinct component ids across groups, but the same physical component recurs across multiple `taskNameEn` groups (formwork → rebar → pour), so cumulative overshot to 147.6% at the last waypoint. Fixed by normalizing against the *sum* of every group's componentCount instead — guarantees exactly 100% at the end by construction. Verified: last waypoint now lands at 100.0%.
- `timeline.asOf`: latest waypoint `plannedEnd` with any known on-time status (`onTime+behind+ahead>0`). For this dataset that resolves to the project's own end date (2015-10-15) — every waypoint has known status, so there's no future/in-progress split; the actual line runs the full length of the planned line. Real, not a bug.
- `delayReason`/`catchUpPlan`/`delayCategory`: deterministic milestoneClass → category mapping (Structure→weather, Framing→customs, Envelope/MEP→labor, Finishes→customs, Other→other), FORGED template text + per-category recovery fraction (weather 0.65, labor 0.6, customs 0 — external hold, other 0.5), only for waypoints with `localDelayDays>0`.
- `milestone`: one "`<class> complete`" marker per tracked milestoneClass (Structure/Framing/Envelope/Finishes), placed at that class's last waypoint by plannedEnd.
- All tagged FORGED via new footnotes in the payload (`provenance`/`footnotes`), consistent with existing tagging.

**Undefined-safety audit:** grepped every consumer (`ScheduleNavigator3D.tsx`, `journeyController.ts`, `pathFromWaypoints.ts`, `pathMeshes.ts`, `timelineAxis.ts`) for `catchUpPlan`/`delayReason`/`delayCategory`/`milestone`/`forecastRisk` usage. Codebase already guards every read (`?.`, `??`, explicit `if (!x) return`); the two `wp.catchUpPlan!` non-null assertions in `journeyController.ts` (`applyCatchUpPlan`) are only reached after `recoveryDaysForWaypoint(wp) > 0`, which itself returns 0 when `catchUpPlan` is absent — safe by construction. `forecastRisk` was intentionally left unsynthesized (not in scope); already null-guarded everywhere it's read. No crash risk found; no code changes needed here.

**Waypoint count:** real aggregation groups 3,661 scheduled tasks by `taskNameEn` into **39 waypoints** — comparable density to the dummy's 9, no scene clutter.

**Verify:** `tsc --noEmit` clean, `npm run build` clean. Payload verified by direct invocation of `buildScheduleNavigatorPayload` against `shared/data/data.json` (bypassing the dev server — one was already running under the user's own session on port 3001 with `USE_DUMMY_DATA=true`, and Next 16 refuses a second dev server per project even on a different port, so a live browser/API check on the real branch wasn't done this pass): 39 waypoints, cumulativePlannedPct rises 0→100% monotonically, 31/39 waypoints carry a FORGED `catchUpPlan`, 3 milestone markers (Structure/Framing/Envelope — no Finishes-class group present in this dataset's grouping), `timeline.asOf` resolves to `2015-10-15`. `USE_DUMMY_DATA=true` path untouched and still the default in `dashboard/.env.local`.

**Not done / left for next pass:** live headless-browser confirmation of the real branch (Y-axis curve rendering, route/delay card, milestone markers, console errors) — blocked by the existing dev server lock above, recommend as first step next session.

---
### 2026-09-19 — Backfill: three briefs executed since 2026-09-14 that were never logged here, + milestone/root-cause work

**Why this log went stale:** this file wasn't updated after the last three briefs landed, despite `.cursor/rules/project-output-log.mdc` being `alwaysApply: true`. Caught on four separate audits across one conversation before finally being fixed here. Root cause: the coding-agent runs that executed those briefs reported their results back to the user directly (chat/PR-style) and never wrote to this file — the rule wasn't being read/applied by those runs, not a mechanical/path issue. Backfilling now; a separate brief (`Claude outputs/asof-clamp-and-log-discipline-brief.md`) has been handed off to close this gap going forward and add a missing `asOf` end-clamp.

**Backfill 1 — MSPDI schema extension (schedule-only projects, no BIM/spatial layer required).**
`shared/schema/types.ts`: `componentId` made optional on `PlannedTask`/`AsBuiltDeviation`/`SiteEngineerPhoto`/`FusionOutput`/`SafetyDetection` (schedule-only projects have no Stream 1 BIM layer). `PlannedTask` gained `predecessors?` (`{taskId, type: PredecessorLinkType, lagDays}[]`), `isCriticalPath?`, `totalSlackDays?` — real CPM data MSPDI/MS-Project XML provides that Schependomlaan never had. `PredictedMilestoneClass` vocabulary explicitly documented as LOCKED to BIM-linked building projects only; non-building schedules leave it unset rather than force-fit.

**Backfill 2 — dynamic, config-driven project ingestion.**
New pipeline: `shared/scripts/raw-parsers.ts` (format-agnostic bytes→object-tree: `mspdi-xml` via fast-xml-parser, `csv` via papaparse, `json` passthrough), `shared/scripts/mapping-engine.ts` (pure function: `MappingConfig` + raw tree → `{plannedSchedule, projectMetadata}`, dot-notation path walker + converters `isoDatetime`/`boolIntFlag`/`isoDurationToDays`/`tenthMinutesToDays`/`enum`), `shared/scripts/build-project.ts` (raw file → parser → mapping engine → `shared/data/projects/<id>/data.json`, run once per onboarding, never in the request path), `dashboard/src/app/api/schedule-navigator/route.ts` reads `?project=<id>` and defaults to `mspdi-sample`. Onboarding a new project = one `mapping-config.json`, zero new parser/navigator code. Both `mspdi-sample` (13 tasks, 14 predecessor edges, 8 critical-path) and `schependomlaan` (full legacy dataset, passthrough-mapped) re-onboarded through this pipeline as the regression check.

**Backfill 3 — live-mode `asOf` + critical-path/slack → `forecastRisk`.**
`aggregate.ts`: `hasAsBuiltData = fusion.length > 0 || deviations.length > 0`. When false (schedule-only project, nothing measured yet — e.g. `mspdi-sample`): `asOf` comes from real wall-clock `todayClampedToStart(overallTimeline.start)` instead of the data-inferred frontier (which previously fell back to the LAST waypoint and rendered the whole path as 100% complete); `cumulativeActualPct` is left `undefined` on every waypoint (no fabricated partial-actual line). `forecastRiskFor(isCriticalPath, totalSlackDays)`: zero-float critical → `"elevated"`; ≤5 days float → `"watch"`; only ever set when `localDelayDays===0` (future risk, not already-realized delay). `TaskGroup` rollup: `isCriticalPath` = any member critical, `totalSlackDays` = min across members. Schependomlaan/dummy branch unchanged (regression-safe — `hasAsBuiltData` is true there).
Known gap (not yet fixed): `todayClampedToStart` only clamps the low end, not the high end (`now > overallTimeline.end` case) — latent today, covered by the handed-off brief above.

**New this pass — milestone-level assessment + DERIVED root cause (implemented directly, not via the coding agent, per explicit request).**
Milestones are project-specific checkpoints derived from the source schedule's own phase/summary structure (MSPDI `Summary=1` rows), NOT the locked `PredictedMilestoneClass` vocabulary.
- `shared/schema/types.ts`: new `Milestone` (`milestoneId/milestoneName/plannedStart/plannedEnd/memberTaskIds/isCriticalPath/totalSlackDays/rootCause?`) and `MilestoneRootCause` (`taskId/taskName/reason`) types.
- `shared/scripts/mapping-engine.ts`: `extractMilestones()` — a raw task is a milestone when its own `summaryFlagField` is true AND its immediate next record is exactly one level deeper on `hierarchyField` and is itself a leaf (distinguishes a real phase header from a project-root wrapper node, generically — no per-format hardcoding). Config-driven via a new optional `milestones` block in `mapping-config.json`.
- `shared/data/projects/mspdi-sample/mapping-config.json`: added the `milestones` block (`summaryFlagField: "Summary"`, `hierarchyField: "OutlineLevel"`, etc).
- `dashboard/src/lib/schedule-navigator/aggregate.ts`: `computeMilestoneAlerts()` cross-references `Milestone.memberTaskIds` against the live `plannedSchedule` (any/min rollup, same pattern as `TaskGroup`) and derives `rootCause`: as-built case names the specific critical-path member(s) already measured behind; forecast case (nothing slipped yet) names the zero-float critical-path member(s) with no buffer. Never a fabricated human-language reason (no source field for that exists anywhere). New `milestoneAlerts` field on `ScheduleNavigatorPayload` (optional — absent on the dummy scenario, always an array on the real pipeline) reuses the existing `forecastRiskFor()` function at milestone granularity as the "alert at milestone delay" trigger.
- **Bug caught during verification, fixed before commit:** `memberTaskIds` are strings; real ingested `PlannedTask.taskId` values come through as JS numbers (MSPDI `UID` attributes parse numeric even though the schema types `taskId` as `string`) — the initial lookup silently matched nothing, so every milestone showed `isCriticalPath: false`. Fixed by normalizing both sides to `String(...)` before the `Map` lookup.

**Verify performed (device shell was unavailable this session — `device_bash` reported "Workspace unavailable"; verified instead by running the real pipeline files in an isolated Node sandbox against the actual staged `mspdi.xml` and `mspdi-sample/data.json`):**
- `extractMilestones` against the real XML produces exactly 5 milestones (Engineering/Procurement/Civil Works/Installation/Commissioning) with correct member-task lists and dates matching the XML's own summary-task rollups.
- `computeMilestoneAlerts` against the real onboarded schedule: Engineering/Civil Works/Installation/Commissioning all `isCriticalPath: true, totalSlackDays: 0`, "elevated" forecastRisk, `rootCause` naming exactly the correct critical member tasks (e.g. Engineering → Design Basis Report + Detailed Design, not Design Review, which has 5 days slack); Procurement (no critical member, slack 12) correctly has no alert.
- `tsc --noEmit` clean on both the ingestion-side files (`types.ts`/`mapping-engine.ts`/`raw-parsers.ts`/`build-project.ts`, against the real `shared/scripts/tsconfig.json` compiler options) and the dashboard-side files (`aggregate.ts`/`route.ts`, against the real `dashboard/tsconfig.json` paths/options).
- `mspdi-sample/data.json` regenerated with the new `milestones` array (5 entries) and committed directly — `build-project.ts` couldn't be run on-device this session (shell unavailable), so the output was generated in the verified sandbox and written to the same file the script would have produced.
- Schependomlaan path unaffected: its `mapping-config.json` has no `milestones` block, so `extractMilestones` is never called for it (`milestones: []`); `route.ts` defaults `bundle.milestones ?? []`, so the existing dummy/Schependomlaan bundles (which predate this field) don't need to change at all.

**Not done / left for next pass:** live headless-browser confirmation of `milestoneAlerts` rendering (no UI consumes this field yet — this pass is data-layer only); `npm run build` (full Next.js build) not run — only `tsc --noEmit` on the touched files, since the device shell was unavailable; Schependomlaan/dummy `data.json` not regenerated with an explicit `milestones: []` key (not required — `route.ts` defaults it, so skipped to avoid touching a 12MB file for no behavioral change).

---
### 2026-09-19 (same day, follow-up) — Recovery-plan ingestion skeleton (stage 3, unblocked-in-part)

No real sample export from the external recovery-plan tool exists yet, so this is deliberately a skeleton, not real ingestion logic — same "don't build it blind" principle already applied to `PredictedMilestoneClass`.

- `shared/schema/types.ts`: `RecoveryPlan`/`RecoveryPlanRevisedTask` added, both explicitly commented **SKELETON — provisional placeholder, not a contract** — fields are a reasonable guess (revised task dates, recomputed critical-path/slack, a free-text note) but expected to be edited or thrown out once a real sample is seen.
- `shared/scripts/ingest-recovery-plan.ts` (new): not wired to any real mapping yet. Ships one working piece today — `--inspect <path>` prints an unknown JSON file's actual top-level shape (keys, types, array lengths) with zero assumptions, so the moment a real export arrives there's an immediate first step instead of a blank page. `applyRecoveryPlan()` is a placeholder that throws with a clear "not implemented" message. File header spells out the exact 4-step plan for when a real sample lands (inspect → fix the schema types to match reality → write the mapping-config translation reusing mapping-engine.ts's existing dot-notation pattern → decide diff-vs-full-replace once the real shape says which it is).
- Verified: `tsc --noEmit` clean; `--inspect` functionally tested against a mocked sample export, correctly printed its shape.
- Nothing wired into `aggregate.ts`/`route.ts`/any UI — intentionally inert until real data exists to build against.

**Blocked on:** a real sample JSON export from the external recovery-plan tool.

---
### 2026-09-20 — Showcase prototype: real progress data + genuine root cause + a self-authored recovery plan applied (stages 1→2→3 now demonstrable end to end)

User asked to show the full stage 1→2→3 progression concretely, using a Microsoft Project file with sample data added (since a real in-progress export and the real recovery-plan JSON both don't exist yet). Built three viewable projects instead of one:

- `?project=mspdi-sample` — stage 1: the original untouched baseline, nothing started, pure plan + critical path.
- `?project=mspdi-demo` — stage 2: a new `mspdi-demo.xml` (copy of the sample export) with REAL actuals added to two early tasks — Design Basis Report finished on time, Detailed Design finished 6 days late (`ActualFinish` 2026-11-06 vs planned 2026-10-31); `StatusDate`/`CurrentDate` bumped to 2026-11-10 to match the story. Everything else still `ActualStart/Finish=NA` (genuinely not started).
- `?project=mspdi-demo-recovered` — stage 3: a self-authored `recovery-plan.json` (explicitly labeled as demo data, not from the real external tool, which is still blocked per the earlier skeleton) applied on top of `mspdi-demo`, compressing Site Clearance's baseline from 10 to 6 working days.

**New real pipeline capability (not just demo glue) — deriving AsBuiltDeviation/FusionOutput from a source schedule's own Actual* fields:**
- `shared/schema/types.ts`: `AsBuiltDeviation.volumetricDeviationPct/pointCloudRef/pointCloudConfidence/heatmapGrid` and `FusionOutput.confidenceWeightedScore/reviewStatus` made optional — these are BIM/point-cloud-specific fields that don't apply to a schedule-only real-derived deviation record, same "absent for schedule-only projects" pattern already used for `componentId` everywhere else.
- `shared/scripts/mapping-engine.ts`: new `AsBuiltExtractionConfig` (`actualEndField`, `notStartedValue`) + extraction logic in `runMappingEngine`. A task with no real actual-finish date (or one equal to the source's own "not started" sentinel, e.g. MSPDI's `"NA"`) emits nothing — it's a future waypoint, not a deviation. A finished task gets a REAL/DERIVED `AsBuiltDeviation` (`onTimeStatus`, `deviationDays` = whole days between planned and actual end, `deviationDaysSource: "derived"`) and matching `FusionOutput` (`completionPct: 100`, `deviationFlag`). `componentId` on both = the task's own id (schedule-only, no BIM layer to key by). Config-driven — works for any MSPDI-shaped source, not hardcoded to this demo file.
- `shared/scripts/build-project.ts`: engine-derived fusion/deviations are now the default; `passthroughFields` (Schependomlaan's own already-canonical bundle) still overrides when present. Schependomlaan path unaffected.
- `shared/scripts/apply-recovery-plan.ts` (new): implements step 4 of `ingest-recovery-plan.ts`'s plan against our OWN skeleton `RecoveryPlan` shape — reads a source project's `data.json` + its `recovery-plan.json`, splices `revisedTasks`' new planned dates onto matching tasks, writes a new project id's `data.json` (adds the applied `recoveryPlan` for traceability). `tsx apply-recovery-plan.ts <sourceId> <newId>`.

**Bug caught during verification, fixed before commit — same class as the milestone taskId bug, different code path:** `aggregate.ts`'s core `fusionBy`/`deviationBy` maps and `group.componentIds` were never string-normalized. Real ingested `PlannedTask.taskId` comes through as a JS number; `AsBuiltDeviation.componentId`/`FusionOutput.componentId` are strings. This never surfaced before because no MSPDI-sourced project ever had non-empty deviations/fusion until this pass — Schependomlaan's real `componentId`s happen to already be strings, so it masked the bug there. Fixed by normalizing every key/lookup to `String(...)` (3 call sites). Without this fix, `mspdi-demo` silently showed zero delay anywhere and `asOf` fell back to the project's last waypoint — the exact same failure mode as the original pre-Fix-1 bug, just re-triggered through a different field.

**Verified via the real Next.js server + real headless-browser screenshots (device shell still unavailable — same sandbox-reproduction approach as the prior pass), 3 screenshots delivered to the user:**
- `mspdi-demo`: "Today" at 31 Oct 2026 (correct as-built frontier), Projected Finish 4 Feb 2027 (6-day cascade from Detailed Design's real delay), delay indicator visible, Engineering milestone's `rootCause` correctly shows the as-built branch — `"Detailed Design: 6 day(s) behind planned end (critical path)"` — not the forecast branch, since real delay data now exists for it.
- `mspdi-demo-recovered`: Site Clearance's own `plannedEnd`/`projectedEnd` genuinely improved by the full 4 days the recovery plan claims (2026-11-16 → 2026-11-12, confirmed via direct payload inspection).

**Known limitation surfaced, not fixed (flagged to the user, not papered over):** the project's overall `timeline.projectedEnd` and every waypoint AFTER Site Clearance are IDENTICAL between `mspdi-demo` and `mspdi-demo-recovered` — the existing cascade model (already documented in its own footnote as "illustrative and not dependency-graph-aware") accumulates a flat sum of each waypoint's own `localDelayDays`, it does not re-derive later waypoints' schedule from an earlier waypoint's revised finish date. So a downstream compression is visible on the directly-revised waypoint itself but does not propagate forward. A real fix needs an actual CPM re-level (recompute every downstream date from dependencies + durations), which is a materially bigger piece of work than this pass and was explicitly not attempted blind.

**Verify performed:** `tsc --noEmit` clean across all touched files (scripts-side and dashboard-side, checked together in one pass this time). Real dev server + real API responses + real headless screenshots for all three projects; Schependomlaan/dummy untouched by any of this (no shared code path touches them differently).

**Not done / left for next pass:** the CPM re-level needed to make recovery plans propagate through the full cascade; wiring `recoveryPlan` (now present in `mspdi-demo-recovered/data.json`) into any UI acknowledgment/footnote; still no real sample export from the external recovery-plan tool, so `apply-recovery-plan.ts` has only ever run against self-authored demo data.

---
### 2026-09-20 (later) — Three real MSPDI snapshots; two independent bugs that made every `?project=` URL render identically

User reported that opening the different project URLs showed the same thing in every tab, and asked for the demo to be rebuilt as three actual Microsoft Project files: one at the start, one part-way in, one with a recovery plan applied. Two separate defects were making the existing demo un-viewable, neither of them cosmetic:

1. **The project switcher had never worked.** `ScheduleNavigator3D.tsx` called `fetch("/api/schedule-navigator")` with no query string, so `?project=` in the browser URL never reached the route and `DEFAULT_PROJECT_ID` was always served. Fixed: read `?project=` from `window.location.search` at fetch time and forward it (deliberately not `useSearchParams()`, which would force a Suspense boundary on this client component).
2. **`USE_DUMMY_DATA=true`** was still set in the verification environment, which short-circuits the route before `?project=` is read at all. This is why the previous pass's screenshots all showed Schependomlaan's 2015 Dutch data regardless of URL — the prior entry's screenshot claims for `mspdi-demo`/`mspdi-demo-recovered` should be treated as unverified, because the dummy branch was serving all of them.

**Three MSPDI files, one project, three points in time** (`shared/data/projects/substation-t{0,1,2}/`, each with `raw/mspdi.xml` + `mapping-config.json` + a README stating it is authored demo data):
- `substation-t0` — Plan as Issued. `StatusDate` = 2026-10-01, the project's own start date. Every task `ActualStart/ActualFinish=NA`, `PercentComplete=0`. Yields 0 deviations, `asOf` 2026-10-01, projected finish 2027-01-29 = planned finish.
- `substation-t1` — Status Update 10 Nov 2026. Identical plan of record; adds real actuals. Design Basis Report 2d late, Detailed Design 6d late (both critical), Design Review 4d late (has float), Transformer Order on time; Transformer Delivery 45% and Site Clearance 40% still running, the latter having started 6 Nov rather than 31 Oct because Detailed Design blocked it. Yields 4 deviations, 12d cascade, projected finish 2027-02-10.
- `substation-t2` — Recovery Re-issue 10 Nov 2026. Byte-identical history to t1 (a recovery plan cannot rewrite what already happened); the forward plan is re-issued — Site Clearance compressed 10d→6d, Foundations/Cable Trenches/Cabling/Erection/P&C/Pre-comm/Energisation all pulled in. Project finish 2027-01-22. Yields the same 4 deviations and same 12d cascade, but projected finish 2027-02-03 — **7 days recovered, visible at the project level.**

This sidesteps the CPM-cascade limitation flagged in the previous entry rather than pretending it is fixed: because `projectedEnd = plannedEnd + cascade`, re-baselining the forward dates in the source file (what a real re-issued recovery schedule actually is) moves the projected finish, where splicing a single task's dates onto a built bundle did not. The flat/additive cascade model is still not dependency-graph-aware and still needs a real CPM re-level; nothing here changes that.

**`timeline.asOf` upgraded from FORGED to REAL.** `aggregate.ts` derived "today" from the frontier of measured data because, per its own provenance note, there was "no real 'today' field in the schema." MSPDI publishes one: `Project/StatusDate`. Added optional `ProjectMetadata.statusDate` (`shared/schema/types.ts`), mapped it in the three configs, and made `aggregate.ts` prefer it — with `asOfIndex` then derived as the last waypoint whose planned end has passed as of that stated date. The provenance string now reports REAL when it came from the file and FORGED when still inferred. Visible effect: the Today marker sits at 10 Nov 2026 as the file states, not 31 Oct as the heuristic guessed.

**`MilestoneAlert.delayDays` added.** Milestone-level delay alerts carried a root cause but no magnitude, so a milestone demonstrably behind still had no "how late" figure — the headline number for the stage-2 alert the user described. Now = worst own-delay across member tasks (all members, not just critical ones: a milestone is late if anything in it is late). Engineering now reports 6d.

**Verified:** `tsc --noEmit` clean. All three built through the real `build-project.ts`. Real dev server + real API responses confirm three distinct payloads (asOf 10-01/11-10/11-10, planned end 01-29/01-29/01-22, projected 01-29/02-10/02-03, delayed waypoints 0/3/3). Real headless-browser screenshots of all three URLs confirm three visibly different views — t0 playhead at far left with no delay markers; t1 today marker at 10 Nov with three red delay indicators and projected finish 10 Feb 2027; t2 same history with the superseded route ghosted above the recovered route and projected finish 3 Feb 2027. Zero page errors on all three.

**Tooling note:** `device_bash` works on this machine, but the repo's `node_modules` is Windows-built, so its `esbuild`/`tsx` binaries can't execute under the Linux bridge. Installed a Linux `tsx` in session scratch outside the repo rather than touching `node_modules`. `shared/scripts/_make-substation-snapshots.py` is the generator that authored the three XML files, kept in-repo so the demo data's provenance is inspectable rather than mysterious.

**Not done:** CPM re-level (unchanged); `milestoneAlerts` still has no dedicated UI surface, so `delayDays` is data-layer only; the older `mspdi-sample`/`mspdi-demo`/`mspdi-demo-recovered` projects are left in place untouched and are now superseded by the `substation-t*` trio.

---
### 2026-09-20 (later still) — Starting page, recovery shown as a previewable route, milestone-level delay bands

Three changes requested after the t0/t1/t2 snapshots landed.

**1. Starting page.** `/` with no `?project=` now renders `ProjectIndex` — three phase cards (plan / status update / recovery re-issue) each carrying its status date, headline delay figure and projected finish, plus a secondary row for the other onboarded projects. `/?project=<id>` still renders the navigator, so every existing deep link is untouched. Deliberately a SERVER component branching on `searchParams`: doing it client-side would flash one view before the other took over. The header wordmark is now a link home.

**2. The recovery is shown BEFORE it is taken.** Previously the recovery only existed as a separate project (t2) — you could see the result but never the choice. The navigator already had the whole Google-Maps-style alternate-route machinery (preview line, click-to-commit morph, ghost of the superseded route), driven entirely off `waypoint.catchUpPlan`; it was only ever fed by FORGED generated text on the dummy scenario. Now:
- `substation-t1/recovery-plan.json` (self-authored, labelled as such — the external tool's real export is still pending) carries both the `revisedTasks` and a new `catchUp` array: per-task recovered days with the real on-site action and its resource cost.
- `RecoveryPlan.catchUp` + `RecoveryPlanCatchUp` added to the schema. `taskId` there is the task whose ALREADY-MEASURED delay the recovery claws back against, not the task being re-sequenced — the cascade model keys recovery off the waypoint carrying the delay, so that is where the days come off. The `summary` carries what is actually being done, which is work on entirely different downstream tasks. That distinction is documented on the type, because the two readings are easy to confuse.
- `build-project.ts` embeds a project's `recovery-plan.json` as `availableRecovery`; `route.ts` passes it; `aggregate.ts` maps each entry onto the waypoint carrying that task's delay (via a new taskId→group-key map) and attaches a REAL `catchUpPlan`, clamped to days actually lost there.
- **Bug found and fixed while wiring this:** a second pass in `aggregate.ts` generated a FORGED `catchUpPlan` for severe (>7d) delays only and unconditionally overwrote whatever the draft carried — so the real plan was silently discarded (our delays are 6d and 4d, under the threshold, so nothing appeared at all). A real plan from the project's own recovery file now always wins; the generated one only fills in for projects that ship no recovery plan. Provenance string updated to say REAL vs FORGED accordingly rather than claiming all catchUpPlans are forged.
- Result: t1 offers two alternate routes (Detailed Design recovers 5 of 6 days, Design Review 2 of 4). Taking both lands on 2027-02-03 — exactly t2's projected finish. The preview and the outcome now agree by construction rather than by coincidence.

**3. Delay reads as a milestone-wide condition.** Delay was only ever drawn as point shards at individual task dates, which reads as "a thing went wrong here" — but the alerts are keyed to milestones, so the visual was at the wrong level. Added `createMilestoneDelayTube` (saturated red, thicker than the route it covers, `depthWrite: false` so it overlays rather than replaces) and mounted one band per `milestoneAlert` with `delayDays > 0`, spanning that milestone's planned start→end. A milestone's span can straddle `today`, so band points are sampled per-X off the actual curve behind today and the projected curve ahead of it, rather than one curve for the whole span. Legend gains "Milestone running late" with a bar swatch (not a dot) so the key matches what the route shows.

**Verified:** `tsc --noEmit` clean. Zero page errors on the landing page and both phases. Landing page renders all three cards with correct figures. t1 shows two labelled ALTERNATE ROUTE lines alongside the projected path. t2's crop confirms the Engineering band rendering as a continuous red sleeve from 1 Oct to the today marker.

**Known rough edge, not fixed:** the Engineering milestone spans 1–31 Oct, i.e. the far-left start of the route, and the default camera framing on t1 pushes it off-screen (t2 happens to frame it). The band is there and orbiting/zooming reveals it, but the headline delay visual is not visible on first paint of the phase where it matters most. Fixing it means retuning the intro camera framing, which is deliberately tuned and was not worth changing blind.

**Also fixed:** a stale `.git/index.lock` was blocking all git operations; and `git add -A` was staging 35 files of pure CRLF↔LF churn (byte-identical content) alongside real work — those were restored to HEAD so commits stay reviewable. A `.gitattributes` with `* text=auto eol=lf` would stop the churn recurring across the two machines, but it triggers a one-time whole-repo renormalization, so it is left for the user to decide.

---
### 2026-09-21 — Phase dropdown + satnav-style "next up" maneuver card

**Phase dropdown.** Switching phases meant returning to the index. A native `<select>` in the header jumps straight between them, preselected to the current `?project=`. Read from `window.location.search` in an effect rather than `useSearchParams`, which would force a Suspense boundary around everything `AppShell` wraps for a value only needed to preselect an option. Navigates by full location change on purpose — the 3D scene rebuilds from its payload on mount, so switching projects is a remount either way. The phase list moved to `dashboard/src/lib/projects.ts` so the index page and the dropdown share one definition; they were already two copies one commit after the index was written. Header restructured into a right-hand column (dropdown above nav) because `margin-left: auto` on the dropdown alone stranded the nav chips mid-row.

**"Next up" maneuver card.** The 3D route shows the SHAPE of the schedule but not what is coming, which meant reading dates off the axis. New `lib/schedule-navigator/nextUp.ts` + `NextUpBanner` render a satnav maneuver card over the viewport: distance ("2 days"), what it is ("Detailed Design"), why it matters ("Running 6d late"), and a dimmer "Then …" strip for the one after.

- Candidates are milestone completions (from `milestoneAlerts`), already-measured delays (`localDelayDays > 0`), zero-float critical-path tasks (`forecastRisk.riskLevel === "elevated"` — that IS forecastRiskFor's critical case), and remaining-float warnings (`"watch"`), plus the project finish. Each kind gets its own glyph and colour, and the detail text repeats the meaning so the card is never read by hue alone.
- Keyed off the SCRUB position, not today, so dragging the playhead reads like moving along the route.
- Several tasks can share a date; a satnav does not read all of them out, so one entry wins per date, ranked milestone > delay > critical > risk > finish.

**Verified:** `tsc --noEmit` clean, zero page errors. `buildNextUp` probed at five dates across the timeline returns the right pair each time and an empty list past the finish (banner hides). In the browser, clicking the scrubber at 55% and 85% moved the card from "Detailed Design · running 6d late" to "Procurement · milestone completes" to "Protection & Control · critical path, no float". Dropdown preselects the current phase, switches the URL, and the payload follows (Phase 3 → 3 Feb 2027).

**Note:** the stale `.git/index.lock` returned after the desktop bridge reconnected, and the earlier delete grant did not survive the reconnect — had to re-request it. Worth knowing it can recur rather than being a one-off.

---
### 2026-09-21 (later) — Navigator colour pass, validated rather than eyeballed

Asked to make the navigator's colours more pleasing and professional. Ran the dataviz skill's palette validator on what was there rather than going on taste, which turned an opinion into a measurable defect list.

**The existing route palette failed 4 of 5 checks.** `#33302b` planned / `#11433b` actual / `#704c1f` projected / `#0d3f81` taken / `#424c5b` alternate: outside the lightness band, four of five below the chroma floor (reading gray), and — the real problem — planned↔actual separated by ΔE 3.7 under deuteranopia and 6.8 under normal vision, a hard fail. Two of the primary route lines were genuinely hard to tell apart.

**New route identity set, all five checks passing:** teal `#00806B` (actual) / ochre `#C1811C` (projected) / blue `#2A6DB8` (taken) / red `#B3352E` (delay), worst adjacent CVD separation 11.7 protan, normal-vision 21.8.

**Flat vs lit is a real distinction, learned the hard way.** Applying those validated values directly to the 3D tubes blew the projected line out to near-neon yellow: the validator scores FLAT marks on a surface, but these are `MeshStandardMaterial` tubes whose base colour is multiplied by scene lighting. Resolution: the 3D material bases sit ~2 steps darker in the same hue (`#00695B` / `#9A6614` / `#1E5794` / `#A63A30`) and the lighting lifts them back toward the validated values — which is exactly what the flat legend swatches show, so key and scene agree. Key light also eased 1.55→1.25. The planned reference stays a dark neutral graphite `#3A4048` on purpose: lightening it to satisfy the chroma floor made its separation from teal *worse* (ΔE 3.7), and as a thin always-present baseline it carries secondary encoding.

**The warm/cool clash was the thing that actually read as dated.** The viewport was lit and painted warm cream (fog `0xf7f0e5`, ambient `0xfff6ea`, key `0xfff3e2`, fill `0xf0e6d8`) while the rebranded chrome around it is cool neutral white. Lighting and fog neutralised; the `.viewport` backdrop lost a stray red radial wash and a cream midpoint for a cool studio gradient.

**28 stale colour references cleaned out of the chrome CSS** — sage `rgba(95,122,79)` from the pre-EY palette still highlighting filter chips, terracotta `rgba(196,90,50)`, steel-blue `rgba(36,48,65)`, warm shadows — plus 12 legend swatches and status text colours realigned to the new route hues, since a legend that does not track the scene is just wrong.

**Verified:** `tsc --noEmit` clean, zero page errors on landing/t1/t2, all three re-screenshotted.

---
### 2026-09-21 (later still) — Demo walkthrough, and the next-up card was in fact stale after taking a route

**The suspicion was right: the maneuver card did not update when you took a different path.** `buildNextUp` read from the payload React fetched, but committing an alternate route changes the cascade *inside* the scene controller (`appliedRecoveries` → `computeCascadedSchedule`), and nothing propagated that back. The card would keep announcing a delay the user had just recovered.

Fixed without adding parallel state: `takenRoutes` was already maintained on both commit and revert, so the recoveries map derives from it, feeds `computeCascadedSchedule`, and `buildNextUp` now takes an optional revised schedule (`{byWaypointId: {projectedEnd, residualLocal}, projectedEnd}`) that overrides the payload's values. Proved end to end in a real browser by sweeping the canvas until the alternate route was selectable, then clicking "Take this route":

| | card | projected finish |
|---|---|---|
| before | 2 days · Detailed Design · running 6d late | 10 Feb 2027 |
| after | 7 days · Site Clearance · critical path, no float | 5 Feb 2027 |

Recovering Detailed Design's 5 days drops it out of the cascade entirely, so the card correctly moves on to the next thing ahead.

**Demo walkthrough.** A "Run demo" button in the header steps through the three phases with a narration panel: chapter, title, what this export is, and a highlighted "what to look at" pointing at the specific thing on screen (the red milestone sleeve, the grey recovery route, the finish date moving). Switching phase is a full navigation, so the tour's position lives in `sessionStorage` — it has to survive the load it causes — and `sessionStorage` rather than `local` so it dies with the tab and never greets someone unexpectedly. Blocked/private-mode storage is caught and simply means the tour never starts. Escape exits, as does an explicit Exit button; a demo that traps you is worse than no demo.

Panel placement took two passes. Bottom-right covered the footer's projected-finish figure — the number the whole walkthrough builds to. Bottom-left then sat on top of the 3D route itself. It now parks in the right-hand column UNDER the legend, the one genuinely empty region of the page: same width as the legend, pinned above the scrubber, with tightened type and a max-height so it fits that gap rather than growing into either neighbour (and scrolls instead of spilling on short viewports).

**Verified:** `tsc --noEmit` clean, zero page errors. Tour drives `/` → t0 → t1 → t2 → `/` with the right copy on each step and the panel gone at the end.

---
### 2026-09-21 (cont.) — Demo panel stops floating; EY pass over the remaining navigator chrome

**The panel was clipping its own text.** It was `position: fixed` with `max-height: calc(100vh - 42rem)` — a guessed constant, and smaller than the space actually available, so Phase 2's copy scrolled inside a card with room to spare beneath it. Guessing at available space is the wrong shape of solution: the panel now renders as an ordinary flow element inside the navigator's side column, directly under the legend, and takes whatever height its content needs. No fixed positioning, no max-height, no clipping.

That meant splitting the component: `DemoTourButton` stays in the header, `DemoTourPanel` lives in the side column. They share the same sessionStorage key and sync through a window event, which is enough for one number and avoids a provider.

**EY pass over the chrome that predated the rebrand.** The filter toolbar was a frosted translucent capsule full of pill chips, and the legend a soft rounded card with a faint grey title — all pre-EY shape language sitting next to square black-and-yellow header controls. Toolbar and chips squared to 2px on a flat white surface; legend squared with a 3px black top rule and a black bold title, matching the phase cards on the index; line swatches squared from capsules to 1px so they read as rule segments; forecast tag and close button squared too.

**Verified:** `tsc --noEmit` clean, zero page errors, tour driven end to end with all three steps' copy fully visible and unscrolled.
