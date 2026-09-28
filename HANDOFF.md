# Handoff — Schedule Navigator

Everything you need to get this running and keep building. Written 28 Sep 2026.

If you only read one thing: **the repo alone will not run.** You must create
`dashboard/.env.local` by hand — it is gitignored. See "What GitHub did not give you".

---

## 1. What this is, in sixty seconds

A construction schedule monitoring dashboard whose centrepiece is a **3D Schedule
Navigator** — a satnav for a project schedule rather than a Gantt chart.

The core idea: a Gantt chart states the plan. A satnav shows where you are, what is
coming, and offers a route when you are late. This does the second thing with a real
Microsoft Project schedule.

It reads **MSPDI** (the XML Microsoft Project exports) and renders the schedule as a
route in 3D. Distance along the route is time; height is cumulative work complete.
Where the actual work diverges from the plan, the route diverges — and the gap *is*
the delay. When a recovery plan exists, it is drawn alongside as a grey alternate
route you can inspect and take, exactly the way a satnav offers a reroute.

There are three demo snapshots of **one** project (a sample substation job), exported
on three different days. That is the whole narrative: plan → slippage → recovery.

---

## 2. Get it running

Known-good toolchain: **Node v22.23.2, npm 10.9.8**. No `engines` field is set, so
nothing will stop you on an older Node — but Next 16 wants Node 20+.

```bash
git clone https://github.com/Shivamowo/construction-monitoring.git
cd construction-monitoring

# Two separate npm projects.
cd dashboard      && npm install && cd ..   # required — runs the app
cd shared/scripts && npm install && cd ../..  # required only to rebuild project data
```

Now create the file GitHub did not give you:

```bash
# dashboard/.env.local   — create this by hand, exactly this line
USE_DUMMY_DATA=false
```

Then:

```bash
cd dashboard
npm run dev          # http://localhost:3001
```

Open `http://localhost:3001/` — you should get a start page listing three phases.

### Verify it actually works

Open these three in order. If all three look identical, something is wrong — see
the troubleshooting table at the bottom.

| URL | What you should see |
|---|---|
| `localhost:3001/?project=substation-t0` | One clean orange route. Projected finish **29 Jan 2027**. No delay markers. |
| `localhost:3001/?project=substation-t1` | Green actual + amber projected + graphite planned + two grey alternates. Finish **4 Feb 2027**. |
| `localhost:3001/?project=substation-t2` | Same history, recovered forward plan. Finish **27 Jan 2027**. |

There is also a **Run demo** button in the header that walks all three phases with
narration. Fastest way to understand the product.

---

## 3. What GitHub did not give you

This is the part that trips people up. Four things are gitignored (see `.gitignore`).

### a. `dashboard/.env.local` — **REQUIRED, create by hand**

Ignored by the `.env.*` rule. One line:

```
USE_DUMMY_DATA=false
```

**Symptom if missing or set to `true`:** every project URL renders the same thing —
a 2015 project with Dutch task names (that is the Schependomlaan dummy dataset). The
`true` branch in `dashboard/src/app/api/schedule-navigator/route.ts` short-circuits
*before* `?project=` is even read. This cost a full debugging session once; do not
repeat it.

### b. `node_modules/` — install fresh, do not copy

Both locations. **Do not copy `node_modules` from another machine**: `tsx`/`esbuild`
ship platform-specific native binaries, so a Windows-built tree will not execute on
macOS/Linux and vice versa. Symptom is an `esbuild` "TransformError" on any `npm run
build-project`.

### c. `shared/raw-data/` — the Schependomlaan source dataset (large, external)

The original BIM/point-cloud dataset: as-planned and as-built models, IFC exports,
drone imagery, point clouds, event logs, planning files.

**You do not need this to run the app or to work on the navigator.** Every project's
`data.json` is committed, so a clean clone renders everything.

You only need it if you re-run the original Schependomlaan ingestion:
`shared/scripts/generate-all.ts` and `shared/scripts/_smoke-ifc.ts` are the only two
scripts that read it. Ask Shivam for the dataset if you need those.

### d. `Claude outputs/` — local working notes

Task briefs and scratch screenshots from the build. Not needed. Ignore it.

---

## 4. The data pipeline

```
mspdi.xml  →  raw-parsers.ts  →  mapping-engine.ts  →  data.json  →  aggregate.ts  →  3D navigator
```

The important property: **onboarding a new project is writing one
`mapping-config.json` — not writing parser code.** The mapping engine is generic and
config-driven; the config describes that source's own field shapes.

To onboard a project:

1. Drop the source file in `shared/data/projects/<newId>/raw/`
2. Write `shared/data/projects/<newId>/mapping-config.json`
3. `cd shared/scripts && npx tsx build-project.ts <newId>`
4. Open `localhost:3001/?project=<newId>`

`data.json` is pre-built and committed. The API route only ever reads the built
bundle — the mapping pipeline never runs in the request path.

### The three snapshots

All three are authored demo data (clearly labelled as such in each project's
`README.md`), generated by `shared/scripts/_make-substation-snapshots.py`. They are
the *same* project at three dates:

| Project | Status date | What it represents |
|---|---|---|
| `substation-t0` | 1 Oct 2026 | Plan as issued. No actuals at all. |
| `substation-t1` | 10 Nov 2026 | Same plan + real actuals. Detailed Design finished 6d late on the critical path; it drives the finish 6 days late (CPM). |
| `substation-t2` | 10 Nov 2026 | Identical history, forward plan re-baselined. Recovers 8 days vs t1. |

`mspdi-sample`, `mspdi-demo`, `mspdi-demo-recovered` are earlier iterations, superseded
by the trio above but left in place and still working.

---

## 5. Where the code lives

| Path | What it does |
|---|---|
| `shared/schema/types.ts` | The canonical schema. Start here to understand the data. |
| `shared/scripts/mapping-engine.ts` | Generic config-driven source → canonical mapping. Milestone + as-built extraction. |
| `shared/scripts/build-project.ts` | Builds one project's `data.json`. |
| `dashboard/src/app/api/schedule-navigator/route.ts` | Reads a built bundle, aggregates, serves the payload. |
| `dashboard/src/lib/schedule-navigator/aggregate.ts` | The brain. Cascade/delay math, milestone alerts, root cause, catch-up plans. |
| `dashboard/src/lib/schedule-navigator/nextUp.ts` | The satnav maneuver card logic. |
| `dashboard/src/components/schedule-navigator-3d/scene/` | Three.js scene: geometry, materials, camera, interaction. |
| `PROJECT_OUTPUT.md` | **Dated build log, 759 lines.** Every decision, bug and limitation, in order. The real history. |

---

## 6. Provenance discipline — please keep this

Every field in the schema is tagged **REAL**, **DERIVED** or **FORGED**, and the
payload carries provenance strings explaining which is which.

This is not decoration. It is the rule that keeps the tool honest: nothing computed
is allowed to quietly present itself as something measured. Two examples of it being
enforced in practice:

- The delay **root cause** names which critical-path task missed its dates. It never
  writes a narrative reason like "bad weather" — the file does not support that claim.
- `timeline.asOf` was `FORGED` (inferred from the frontier of measured data) until
  MSPDI's real `Project/StatusDate` was wired through; it is now tagged `REAL`.

If you add a field, tag it. If you compute something, say so.

---

## 7. Known limitations and open work

Honest list. None of these are hidden bugs — they are documented decisions.

1. ~~The cascade is additive, not a real CPM re-level.~~ Fixed 28 Sep 2026: projected
   dates come from a forward pass over the schedule's own FS/SS/FF/SF links
   (`dashboard/src/lib/schedule-navigator/cpm.ts`), verified by hand-trace on t1. Projects
   with no predecessor links (Schependomlaan) get no propagation at all, by design.
   Caveat: `_make-substation-snapshots.py` regenerates from `mspdi-sample`, which still
   has the Erection → P&C link as FF+5; re-running it would revert the FS+5 fix below.
2. **Recovery plans are self-authored.** The external tool meant to supply them has no
   export format yet. `shared/scripts/ingest-recovery-plan.ts` has an `--inspect` mode
   ready to receive a real sample and is deliberately left inert until one exists.
   `substation-t1/recovery-plan.json` is demo data, labelled as such.
3. ~~`milestoneAlerts` has no dedicated UI panel.~~ Done 28 Sep 2026: "Milestone alerts"
   panel under the legend (`MilestoneAlertsPanel.tsx`), click to focus the span.
4. ~~Camera framing on first paint~~ Fixed 28 Sep 2026 — cause was a mount-time camera
   fly inside the alternate-route builder, not the intro frame itself. See the log.
5. **Stage 4 not started** — continuous execution watching and re-projection. Depends
   on the real recovery-plan format landing first.

---

## 8. Gotchas that will waste your day

| Symptom | Cause | Fix |
|---|---|---|
| Every `?project=` URL shows the same 2015 Dutch data | `USE_DUMMY_DATA=true` or `.env.local` missing | Create `dashboard/.env.local` with `USE_DUMMY_DATA=false`, restart |
| Changes to files don't appear | Stale dev server; the Next watcher misses some edits | Kill and restart `npm run dev` |
| `esbuild` TransformError on any `tsx` script | `node_modules` copied from another OS | Delete it, `npm install` fresh |
| Git shows hundreds of changed files you didn't touch | CRLF↔LF churn between Windows and macOS/Linux | See below |
| `fatal: Unable to create '.git/index.lock'` | Stale lock from an interrupted git command | Delete `.git/index.lock` (check no git process is actually running) |

### The line-endings one, specifically

Shivam develops on Windows. If you are on macOS or Linux you will see large diffs of
byte-identical files. Before committing, check whether a "changed" file differs only
in line endings:

```bash
git show :path/to/file | tr -d '\r' | diff - <(git show HEAD:path/to/file | tr -d '\r')
```

**The permanent fix** is a `.gitattributes` at the repo root:

```
* text=auto eol=lf
```

This has *not* been added, because it triggers a one-time renormalization touching
every file in the repo. Agree with Shivam before doing it — but it is the right call
once you are both working on this.

---

## 9. Suggested first hour

1. Get it running, open all three phase URLs, confirm the finish dates match the table
   in section 2.
2. Press **Run demo** and let it walk you through.
3. On Phase 2, click a grey alternate route, read the trade-off panel, press
   **Take this route** — watch the amber path morph and the finish date move.
4. Skim the last ~200 lines of `PROJECT_OUTPUT.md` for current context.
5. Read `aggregate.ts` top to bottom. It is the densest file and the one that explains
   how everything is derived.
