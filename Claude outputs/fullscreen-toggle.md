TOKEN DISCIPLINE. Terse. No narration.

# Add full-screen toggle to Schedule Navigator

Add a button (top-right of viewport, consistent with existing light/cream + `--chrome-accent` theme) that expands the 3D canvas + its chrome (status bar, legend, filter chips) to fill the browser viewport, hiding any outer app shell/nav.

Implementation: use the Fullscreen API (`element.requestFullscreen()` / `document.exitFullscreen()`) on the viewport container, not a CSS-only fake fullscreen — real fullscreen for demo/presentation use. Toggle icon/label swaps (expand ↔ collapse) based on `document.fullscreenElement` state; listen for `fullscreenchange` to stay in sync if the user exits via Esc.

On resize/fullscreen-enter, trigger the existing camera/renderer resize handler (already wired for window resize) so the WebGL canvas doesn't stay clipped at its pre-fullscreen size.

Verify: click toggle, canvas fills viewport, all chrome scales correctly, click again (or Esc) returns to normal layout, no console errors, no broken camera aspect ratio. Log to `PROJECT_OUTPUT.md`.
