# Dummy Schedule Navigator scenario

`dataProvenance: "dummy"` — internally consistent fiction for UI work. Not from `schedule.json` / fusion / deviation.

## Project

**Schependomlaan (dummy)** — mid-size residential shell & core, Nijmegen area.

| Milestone | Date |
|-----------|------|
| Project start | **2015-03-02** |
| Planned handover | **2015-09-18** |
| **Today (asOf)** | **2015-07-10** |
| At-risk projected handover (no catch-up applied) | **2015-10-18** (+30d) |

Today sits after foundations + structural-frame delays have landed, during envelope recovery from a failed inspection, and **before** MEP rough-in starts in earnest.

## Delay events (3)

### 1. Foundations — weather / groundwater (+9d)
- **When:** March–April 2015 pour window
- **Cause:** Prolonged rainfall and high groundwater; consecutive pour days cancelled
- **Days lost:** 9
- **Catch-up:** Weekend overtime crews + accelerated rebar set → **recover 6 of 9 days**
- **Residual if catch-up applied:** 3 days remain on the cascade

### 2. Structural frame — customs / material hold (+14d)
- **When:** May–June 2015 steel package
- **Cause:** Primary steel shipment held at Rotterdam customs (documentation mismatch); erection idle
- **Days lost:** 14
- **Catch-up:** *None* — supplier lead time cannot be compressed further this quarter
- **Residual:** **14 days fully unresolved** ← primary driver of planned-vs-projected gap

### 3. Envelope shell — inspection failure (+7d)
- **When:** Late June / early July 2015 (straddles “today”)
- **Cause:** Firestopping inspection failed; remediation and re-inspection required before close-in
- **Days lost:** 7
- **Catch-up:** Parallel trades on cleared elevations while remediation runs → **recover 4 of 7 days**
- **Residual if catch-up applied:** 3 days remain

## Cascade arithmetic (illustrative, not dependency-graph-aware)

| State | Cumulative delay at handover | Projected handover |
|-------|------------------------------|--------------------|
| No catch-up (current forecast) | 9 + 14 + 7 = **30d** | 2015-09-18 → **2015-10-18** |
| Foundations catch-up only (−6) | 3 + 14 + 7 = **24d** | **2015-10-12** |
| Envelope catch-up only (−4) | 9 + 14 + 3 = **26d** | **2015-10-14** |
| Both catch-ups (−6 and −4) | 3 + 14 + 3 = **20d** | **2015-10-08** |

In every catch-up case the finish is still later than planned because the **14-day steel customs hold has no recovery plan**.

## Waypoint coverage vs today

**Actual-to-date (≤ asOf 2015-07-10):** site-prep → foundations → slab → structural-frame → envelope (in progress).

**Projected (after today):** MEP → interiors → roof → handover.
