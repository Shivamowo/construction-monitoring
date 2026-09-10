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