"""
Authors three MSPDI snapshots of the SAME Sample Substation Project, at three
points in its life. Source of truth for the demo's stage-1/2/3 story.

Convention in this schedule family (calibrated from the original sample file):
  * Start/Finish  = the PLAN OF RECORD (what the team committed to)
  * Actual*       = what really happened
  * Duration      = calendar days between Start and Finish, x8h
A recovery re-issue revises Start/Finish for work not yet complete; it never
rewrites history, so the Actual* values are identical in T1 and T2.
"""
import xml.etree.ElementTree as ET
import datetime as dt
import copy, os

NS = 'http://schemas.microsoft.com/project'
ns = {'m': NS}
ET.register_namespace('', NS)

BASE = os.path.expanduser('~/mnt/construction-monitoring/shared/data/projects/mspdi-sample/raw/mspdi.xml')
OUT_ROOT = os.path.expanduser('~/mnt/construction-monitoring/shared/data/projects')

def g(el, name):
    c = el.find(f'm:{name}', ns)
    return c.text if c is not None else None

def setf(el, name, value):
    c = el.find(f'm:{name}', ns)
    if c is None:
        raise KeyError(f'{name} not present on element')
    c.text = value
    return c

def caldays(a, b):
    return (dt.date.fromisoformat(b[:10]) - dt.date.fromisoformat(a[:10])).days

def dur(a, b):
    return f'PT{caldays(a,b)*8}H0M0S'

S = lambda d: f'{d}T08:00:00'
F = lambda d: f'{d}T17:00:00'

# --- T1/T2 shared history: what actually happened by 2026-11-10 -------------
# (uid -> actual start, actual finish or None if still running, % complete)
ACTUALS = {
    '3':  ('2026-10-01', '2026-10-13', 100),   # plan ->10-11 : 2 days late
    '4':  ('2026-10-13', '2026-11-06', 100),   # plan ->10-31 : 6 days late (critical)
    '5':  ('2026-10-26', '2026-10-30', 100),   # plan ->10-26 : 4 days late (has float)
    '7':  ('2026-10-16', '2026-10-21', 100),   # on time
    '8':  ('2026-10-21', None,          45),   # long-lead delivery, running
    '10': ('2026-11-06', None,          40),   # started late, blocked by uid 4
}

# --- T2 only: the recovery re-issue (revised plan for incomplete work) ------
RECOVERY = {
    '10': ('2026-11-06', '2026-11-12'),
    '11': ('2026-11-12', '2026-12-01'),
    '12': ('2026-11-22', '2026-12-01'),
    '15': ('2026-12-01', '2026-12-19'),
    '14': ('2026-12-15', '2026-12-28'),
    '16': ('2026-12-28', '2027-01-07'),
    '18': ('2027-01-07', '2027-01-17'),
    '19': ('2027-01-17', '2027-01-22'),
}
RECOVERY_SUMMARIES = {
    '9':  ('2026-11-06', '2026-12-01'),
    '13': ('2026-12-01', '2027-01-07'),
    '17': ('2027-01-07', '2027-01-22'),
    '1':  ('2026-10-01', '2027-01-22'),
    '0':  ('2026-10-01', '2027-01-22'),
}

def build(variant, status_date, project_finish, title_suffix):
    tree = ET.parse(BASE)
    root = tree.getroot()

    setf(root, 'StatusDate', F(status_date))
    setf(root, 'CurrentDate', S(status_date))
    setf(root, 'FinishDate', F(project_finish))
    setf(root, 'LastSaved', S(status_date))
    setf(root, 'Title', f'Sample Substation Project — {title_suffix}')
    setf(root, 'Name', f'substation-{variant}.xml')

    for t in root.find('m:Tasks', ns):
        uid = g(t, 'UID')

        if variant == 't2' and uid in RECOVERY:
            s, f = RECOVERY[uid]
            setf(t, 'Start', S(s)); setf(t, 'Finish', F(f)); setf(t, 'Duration', dur(s, f))
            for fld in ('EarlyStart', 'LateStart', 'ManualStart'):
                if t.find(f'm:{fld}', ns) is not None: setf(t, fld, S(s))
            for fld in ('EarlyFinish', 'LateFinish', 'ManualFinish'):
                if t.find(f'm:{fld}', ns) is not None: setf(t, fld, F(f))
            if t.find('m:ManualDuration', ns) is not None: setf(t, 'ManualDuration', dur(s, f))
        if variant == 't2' and uid in RECOVERY_SUMMARIES:
            s, f = RECOVERY_SUMMARIES[uid]
            setf(t, 'Start', S(s)); setf(t, 'Finish', F(f)); setf(t, 'Duration', dur(s, f))

        if variant in ('t1', 't2') and uid in ACTUALS:
            astart, afinish, pct = ACTUALS[uid]
            setf(t, 'ActualStart', S(astart))
            setf(t, 'PercentComplete', str(pct))
            setf(t, 'PercentWorkComplete', str(pct))
            plan_end = g(t, 'Finish')
            if afinish:
                setf(t, 'ActualFinish', F(afinish))
                setf(t, 'ActualDuration', dur(astart, afinish))
                setf(t, 'RemainingDuration', 'PT0H0M0S')
            else:
                setf(t, 'ActualDuration', dur(astart, status_date))
                setf(t, 'RemainingDuration', dur(status_date, plan_end[:10]) if caldays(status_date, plan_end[:10]) > 0 else 'PT0H0M0S')

    out_dir = os.path.join(OUT_ROOT, f'substation-{variant}', 'raw')
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, 'mspdi.xml')
    tree.write(out, encoding='UTF-8', xml_declaration=True)
    print(f'  wrote {out}')
    return out

print('Generating three MSPDI snapshots:')
build('t0', '2026-10-01', '2027-01-29', 'Plan as Issued')
build('t1', '2026-11-10', '2027-01-29', 'Status Update 10 Nov 2026')
build('t2', '2026-11-10', '2027-01-22', 'Recovery Re-issue 10 Nov 2026')
print('done')
