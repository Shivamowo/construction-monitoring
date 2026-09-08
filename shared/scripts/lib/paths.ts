import path from "node:path";
import fs from "node:fs";

// This file lives in shared/scripts/lib/ → go up two levels to shared/
export const SHARED = path.resolve(__dirname, "../..");
export const ROOT = path.resolve(SHARED, "..");
export const RAW = path.join(SHARED, "raw-data");
export const DATA = path.join(SHARED, "data");
export const SCHEMA = path.join(SHARED, "schema");

export const IFC_PATH = path.join(RAW, "Design model IFC", "IFC Schependomlaan.ifc");
export const PLANNED_CSV = path.join(
  RAW,
  "Event log",
  "Eventlog As Planned",
  "eventlog IFC schependomlaan.csv"
);
export const ASBUILT_CSV = path.join(
  RAW,
  "Event log",
  "Eventlog with As Built information",
  "Schependomlaan eventlog as planned data incl as built data.csv"
);
export const XLSX_PATH = path.join(
  RAW,
  "Comparison As Planned As Built",
  "comparison_all weeks.xlsx"
);
export const POINT_CLOUDS_DIR = path.join(RAW, "Point Clouds");

export const SCHEMA_VERSION = "1.0.0";

export const IFC_TYPE_ENUM = [
  "Beam",
  "Building Element Proxy",
  "Column",
  "Covering",
  "Distribution Element",
  "Door",
  "Member",
  "Pipe Segment",
  "Railing",
  "Roof",
  "Slab",
  "Stair",
  "Wall",
  "Window",
] as const;

export type IfcEnumName = (typeof IFC_TYPE_ENUM)[number];

/** Map IFC class names (with or without Ifc prefix / StandardCase) onto our 14-value enum. */
export function mapIfcClassToEnum(raw: string | null | undefined): IfcEnumName | null {
  if (!raw) return null;
  let s = raw.trim();
  if (s.toLowerCase().startsWith("ifc")) s = s.slice(3);
  s = s.replace(/StandardCase$/i, "").replace(/ElementedCase$/i, "");
  const spaced = s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();

  const aliases: Record<string, IfcEnumName> = {
    Beam: "Beam",
    "Building Element Proxy": "Building Element Proxy",
    BuildingElementProxy: "Building Element Proxy",
    Column: "Column",
    Covering: "Covering",
    "Distribution Element": "Distribution Element",
    DistributionElement: "Distribution Element",
    Door: "Door",
    Member: "Member",
    "Pipe Segment": "Pipe Segment",
    PipeSegment: "Pipe Segment",
    Railing: "Railing",
    Roof: "Roof",
    Slab: "Slab",
    Stair: "Stair",
    Wall: "Wall",
    Window: "Window",
    WallStandardCase: "Wall",
    BuildingElementPart: "Building Element Proxy",
    "Building Element Part": "Building Element Proxy",
  };

  if (aliases[spaced]) return aliases[spaced];
  if (aliases[s]) return aliases[s];
  if ((IFC_TYPE_ENUM as readonly string[]).includes(spaced)) return spaced as IfcEnumName;
  return null;
}

/** Parse DD-MM-YYYY (also D-M-YYYY) into ISO date YYYY-MM-DD. */
export function parseDutchDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y.toString().padStart(4, "0")}-${mo.toString().padStart(2, "0")}-${d
    .toString()
    .padStart(2, "0")}`;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  const mb = fs.statSync(filePath).size / (1024 * 1024);
  console.log(`Wrote ${filePath} (${mb.toFixed(2)} MB)`);
}

/** Deterministic PRNG from string seed (mulberry32). */
export function seededRandom(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DRONE_FOOTAGE_URL = "https://mega.nz/#F!sQ50jBaS!-o-iNQEZMaKtgdr67X9sjw";

export const WEEKLY_IFC_SNAPSHOTS: Array<{ week: number; date: string; filename: string }> = [
  { week: 26, date: "2015-06-26", filename: "Week 26 26 june IFC Schependomlaan incl planningsdata.ifc" },
  { week: 27, date: "2015-07-03", filename: "Week 27 3 july IFC Schependomlaan incl planningsdata.ifc" },
  { week: 28, date: "2015-07-10", filename: "Week 28 10 july IFC Schependomlaan incl planningsdata.ifc" },
  { week: 29, date: "2015-07-17", filename: "Week 29 17 july IFC Schependomlaan incl planningsdata.ifc" },
  { week: 30, date: "2015-07-24", filename: "Week 30 24 july IFC Schependomlaan incl planningsdata.ifc" },
  { week: 37, date: "2015-09-11", filename: "Week 37 11 sept IFC Schependomlaan incl planningsdata.ifc" },
];

/**
 * Return the list of weekly IFC snapshot filenames relevant to a task's timeframe.
 * If task is before all snapshots (e.g. Feb-June), all weekly snapshots are relevant as planned built elements.
 * If task overlaps or finishes after specific snapshots, return snapshots from the task start onwards.
 */
export function resolveWeeklyIfcSnapshots(plannedStart: string, plannedEnd: string): string[] {
  const relevant = WEEKLY_IFC_SNAPSHOTS.filter((s) => s.date >= plannedStart);
  if (relevant.length === 0) {
    // Task finishes after Week 37; assign Week 37 (latest available snapshot)
    return [WEEKLY_IFC_SNAPSHOTS[WEEKLY_IFC_SNAPSHOTS.length - 1].filename];
  }
  return relevant.map((s) => s.filename);
}

export const DUTCH_TASK_TRANSLATIONS: Record<string, string> = {
  "Afstorten kanaalplaat": "Grouting hollow-core slabs",
  "Bekisten liftvloer": "Formwork elevator pit floor",
  "Bekisten liftwanden": "Formwork elevator shaft walls",
  "Dakbedekking platte daken": "Roofing flat roofs",
  "Dakpannen": "Roof tiles installation",
  "Dakramen": "Roof windows / skylights installation",
  "Installateurs": "MEP installers / subcontractors",
  "Kanaalplaatvloer leggen (lev. week 16)": "Laying hollow-core floor slabs (delivery week 16)",
  "Leggen breedplaat incl. Veiligheid": "Laying wide-slab precast floors incl. safety measures",
  "Lijmwerk kalkzandsteen elementen": "Adhesive masonry calcium silicate elements",
  "Metselwerk": "Bricklaying / masonry",
  "Metselwerk onderpeil (buitenblad)": "Below-ground masonry (outer leaf)",
  "Nuts invoeren": "Utility service conduit entry",
  "Opstellen": "Site setup / assembly",
  "Opstorten fundering": "Concrete pouring foundation",
  "Plaatsen kozijnen": "Installing window/door frames",
  "Plaatsen scharnierkap incl. goot en platte daken": "Installing hinged roof structure incl. gutters and flat roofs",
  "Plaatsen stalen kolommen": "Erecting structural steel columns",
  "Prefab betonband": "Precast concrete edge beam",
  "Prefab trappen en bordes": "Precast stairs and landings",
  "Prefab trappen en bordes 2e verd.": "Precast stairs and landings 2nd floor",
  "Randkist": "Edge formwork installation",
  "Staalconstuctie dak": "Roof structural steelwork",
  "Stalen balken": "Structural steel beams installation",
  "Stellen bruggetjes": "Positioning temporary bridge supports",
  "Stellen funderingkist incl. poeren": "Setting foundation formwork incl. pad footings",
  "Stelwerk /lijmwerk lift": "Setting / gluing elevator shaft blocks",
  "Stelwerk buitengevel": "Setting exterior facade profiles",
  "Stelwerk kalkzandsteen": "Setting calcium silicate wall profiles",
  "Stelwerk metselwerk onder peil": "Setting masonry profiles below ground level",
  "Stort": "Concrete pour",
  "Stort liftvloer": "Concrete pour elevator floor",
  "Stort liftwanden": "Concrete pour elevator walls",
  "Wapening": "Rebar / reinforcement placement",
  "Wapening liftvloer": "Rebar placement elevator floor",
  "Wapening liftwanden": "Rebar placement elevator walls",
  "Werkvloer liftput": "Mud slab / blinding concrete elevator pit",
  "Zink goot": "Zinc gutter installation",
  "Zinken bekleding dakkapelen": "Zinc cladding dormer roofs",
};
