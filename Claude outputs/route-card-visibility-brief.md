# Route/delay card: anchor to scene + boost visual hierarchy

Work directly. No confirmation. Minimal output.

## Diagnosis (confirmed in current code)

- Card renders inside a fixed `<aside className={styles.sidePanel}>` (`ScheduleNavigator3D.tsx` ~line 619) — disconnected from the clicked route/shard's location in the scene. No pointer/leader-line.
- `controller.getShardScreenAnchor()` still exists (`journeyController.ts` ~line 1506, interface ~line 159) — it projects the selected point to 2D screen coords — but nothing in `ScheduleNavigator3D.tsx` calls it anymore. A live-tracking popover using this method existed in an earlier pass and was lost; only a fade-in entrance animation remains (~line 213-220).
- Inside the card, cost/consequence text (`.routeOptionSuggested`: "−6d · +2 concrete crews, 3 weekends of overtime") has the same visual weight as `.routeOption` ("Current path · no change"). No hierarchy.
- Same flatness applies to the forecast/predicted-risk card ("+5 days · risk watch").

## Fix

1. **Re-anchor the card to the scene.** Bring back a `requestAnimationFrame` loop (keyed on `selected`/`selectedRoute`) that reads `controllerRef.current.getShardScreenAnchor()` each frame and:
   - draws a short leader line (simple SVG line or 2px div rotated via `transform`) from the anchor point to the card's near edge,
   - positions the card near that anchor (offset so it doesn't cover the shard/route geometry), clamped on-screen,
   - hides/fades the leader+card if `onScreen` is false.
   Do this for both the alternate-route card and the delay/forecast card — same mechanism, same file.

2. **Boost hierarchy in the card.** `.routeOptionSuggested` (the cost block) becomes the dominant element: larger font-size for the `-6d · ...` line, bold, a stronger background/border than `.routeOption`, small icon (crew/clock) optional. `.routeOption` (current path / no change) goes visually quiet — smaller, muted color, no border — it's the non-action baseline, not a competing option. Apply the same weighting to the forecast card's "+5 days" line vs. its supporting text.

3. **Do not implement this pass** (logged as backlog only): delay shards should NOT all clear when a route is taken — some residual delay should remain post-catch-up, matching the Google-Maps mental model (an alternate route reduces some delay, doesn't erase all risk). Data/behavior change, not UI — separate task.

## Verification

Same as prior patches: `tsc --noEmit`, `npm run build`, headless check confirming the card visibly connects to its shard/route via leader line while orbiting/scrubbing, cost block reads as the clear focal point. Log to `PROJECT_OUTPUT.md`.
