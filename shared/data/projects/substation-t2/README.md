# substation-t2 — Recovery Re-issue (10 Nov 2026)

AUTHORED DEMO DATA. Not a real export from a live project, and not yet from
the external recovery-plan tool — that integration is still pending its real
export format (see `shared/scripts/ingest-recovery-plan.ts`).

Snapshot 3 of 3. History is identical to `substation-t1` — the same
`Actual*` values, because a recovery plan cannot rewrite what already
happened. What changes is the forward plan, re-issued to claw back time:

| Task | Original plan | Re-issued plan | Pulled in |
|---|---|---|---|
| Site Clearance | 31 Oct – 10 Nov | 6 – 12 Nov | compressed 10d to 6d |
| Foundations | 10 Nov – 5 Dec | 12 Nov – 1 Dec | 4 days |
| Cable Trenches | 20 Nov – 5 Dec | 22 Nov – 1 Dec | overlapped with Foundations |
| Cabling | 5 – 25 Dec | 1 – 19 Dec | 6 days |
| Transformer Erection | 15 – 30 Dec | 15 – 28 Dec | 2 days (delivery-constrained) |
| Protection & Control | 4 – 14 Jan | 28 Dec – 7 Jan | 7 days |
| Pre-commissioning | 14 – 24 Jan | 7 – 17 Jan | 7 days |
| Energisation | 24 – 29 Jan | 17 – 22 Jan | 7 days |

Project finish moves from 29 Jan 2027 to 22 Jan 2027.

This is the navigator's stage-3 view: the alternate route, with the delay
history still visible behind it.
