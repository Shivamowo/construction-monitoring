TOKEN DISCIPLINE. Terse. No narration.

# Amend prior critical-path brief: gate behind a toggle

Milestones: no change, stays always-visible overlay.

Critical path (accent tube + diamond marker from prior brief): add a toggle chip, same style/row as existing category/severity filter chips (`--chrome-accent` theme). Default **off** — critical-path visuals hidden until user opts in.

Implementation: reuse the existing filter-chip pattern/component, don't build a new control type. Toggling sets `.visible` on the critical-path overlay tube(s) + diamond marker meshes only — same mechanism already used for shard category/severity filters. No effect on base planned/actual/projected tubes, milestones, or shards.

Verify: screenshot with toggle off (no critical-path visuals, everything else normal) and toggle on (critical segments + diamond markers appear). Update `PROJECT_OUTPUT.md`.
