/**
 * Stream 1: Parse Schependomlaan design IFC → shared/data/components.json
 */
import fs from "node:fs";
import path from "node:path";
import * as WebIFC from "web-ifc";
import {
  DATA,
  IFC_PATH,
  mapIfcClassToEnum,
  writeJson,
  type IfcEnumName,
} from "./lib/paths";
import type { BimComponent, GeometryBounds } from "../schema/types";

const ELEMENT_TYPE_IDS: Array<{ typeId: number; name: string }> = [
  { typeId: WebIFC.IFCWALL, name: "IfcWall" },
  { typeId: WebIFC.IFCWALLSTANDARDCASE, name: "IfcWallStandardCase" },
  { typeId: WebIFC.IFCSLAB, name: "IfcSlab" },
  { typeId: WebIFC.IFCSLABSTANDARDCASE, name: "IfcSlabStandardCase" },
  { typeId: WebIFC.IFCBEAM, name: "IfcBeam" },
  { typeId: WebIFC.IFCBEAMSTANDARDCASE, name: "IfcBeamStandardCase" },
  { typeId: WebIFC.IFCCOLUMN, name: "IfcColumn" },
  { typeId: WebIFC.IFCCOLUMNSTANDARDCASE, name: "IfcColumnStandardCase" },
  { typeId: WebIFC.IFCDOOR, name: "IfcDoor" },
  { typeId: WebIFC.IFCDOORSTANDARDCASE, name: "IfcDoorStandardCase" },
  { typeId: WebIFC.IFCWINDOW, name: "IfcWindow" },
  { typeId: WebIFC.IFCWINDOWSTANDARDCASE, name: "IfcWindowStandardCase" },
  { typeId: WebIFC.IFCCOVERING, name: "IfcCovering" },
  { typeId: WebIFC.IFCMEMBER, name: "IfcMember" },
  { typeId: WebIFC.IFCRAILING, name: "IfcRailing" },
  { typeId: WebIFC.IFCROOF, name: "IfcRoof" },
  { typeId: WebIFC.IFCSTAIR, name: "IfcStair" },
  { typeId: WebIFC.IFCBUILDINGELEMENTPROXY, name: "IfcBuildingElementProxy" },
  { typeId: WebIFC.IFCBUILDINGELEMENTPART, name: "IfcBuildingElementPart" },
  { typeId: WebIFC.IFCDISTRIBUTIONELEMENT, name: "IfcDistributionElement" },
  { typeId: WebIFC.IFCPIPESEGMENT, name: "IfcPipeSegment" },
];

function vecFromFlat(arr: Float32Array | number[], i: number): [number, number, number] {
  return [arr[i], arr[i + 1], arr[i + 2]];
}

function transformPoint(
  m: number[] | Float32Array,
  p: [number, number, number]
): [number, number, number] {
  // Column-major 4x4
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  return [x, y, z];
}

function emptyBounds(): GeometryBounds {
  return { min: [0, 0, 0], max: [0, 0, 0], centroid: [0, 0, 0] };
}

function computeBoundsFromMesh(
  api: WebIFC.IfcAPI,
  modelID: number,
  expressID: number
): GeometryBounds | null {
  try {
    const flat = api.GetFlatMesh(modelID, expressID);
    if (!flat || !flat.geometries || flat.geometries.size() === 0) return null;

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    let count = 0;
    let sumX = 0,
      sumY = 0,
      sumZ = 0;

    const geomCount = flat.geometries.size();
    for (let g = 0; g < geomCount; g++) {
      const placed = flat.geometries.get(g);
      const geom = api.GetGeometry(modelID, placed.geometryExpressID);
      const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      // web-ifc vertex layout: x,y,z,nx,ny,nz per vertex
      const stride = 6;
      const matrix = placed.flatTransformation;
      for (let i = 0; i + 2 < verts.length; i += stride) {
        const local = vecFromFlat(verts, i);
        const [x, y, z] = transformPoint(matrix, local);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
        sumX += x;
        sumY += y;
        sumZ += z;
        count++;
      }
      geom.delete?.();
    }
    flat.delete?.();

    if (!count || !Number.isFinite(minX)) return null;
    return {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      centroid: [sumX / count, sumY / count, sumZ / count],
    };
  } catch {
    return null;
  }
}

function extractString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === "string") return val;
  if (typeof val === "object" && val !== null && "value" in (val as object)) {
    const v = (val as { value: unknown }).value;
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function digNlSfb(obj: unknown, depth = 0): string | null {
  if (!obj || depth > 6) return null;
  if (typeof obj === "string") {
    if (/^\d{4}/.test(obj) || /nl[\s-]?sfb/i.test(obj)) return obj;
    return null;
  }
  if (typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const [k, v] of Object.entries(rec)) {
    if (/nl[\s-]?sfb|classification|ItemReference|Identification/i.test(k)) {
      const s = extractString(v);
      if (s) return s;
    }
    const nested = digNlSfb(v, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function digMaterialName(obj: unknown, depth = 0): string | null {
  if (!obj || depth > 6) return null;
  if (typeof obj === "string" && obj.trim()) return obj;
  if (typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const key of ["Name", "Material", "ForLayerSet", "Materials", "MaterialLayers"]) {
    if (key in rec) {
      const s = extractString(rec[key]) ?? digMaterialName(rec[key], depth + 1);
      if (s) return s;
    }
  }
  for (const v of Object.values(rec)) {
    const s = digMaterialName(v, depth + 1);
    if (s) return s;
  }
  return null;
}

export interface IfcParseResult {
  components: BimComponent[];
  guidSet: Set<string>;
  buildingId: string;
  typeCounts: Record<string, number>;
  geometryHitRate: number;
}

export async function parseIfc(
  expressIdToGuid?: Map<number, string>
): Promise<IfcParseResult> {
  if (!fs.existsSync(IFC_PATH)) {
    throw new Error(`IFC not found: ${IFC_PATH}`);
  }

  console.log("Loading IFC:", IFC_PATH);
  const data = fs.readFileSync(IFC_PATH);
  const api = new WebIFC.IfcAPI();
  // Point wasm next to the package
  const wasmDir = path.dirname(require.resolve("web-ifc"));
  await api.Init((file) => path.join(wasmDir, file));

  const modelID = api.OpenModel(new Uint8Array(data));
  if (modelID < 0) throw new Error("Failed to open IFC model");

  // Building GUID
  let buildingId = "unknown";
  const buildingIds = api.GetLineIDsWithType(modelID, WebIFC.IFCBUILDING);
  if (buildingIds.size() > 0) {
    const b = api.GetLine(modelID, buildingIds.get(0));
    buildingId = extractString(b.GlobalId) ?? "unknown";
  }

  // Storey map: expressID → name
  const storeyName = new Map<number, string>();
  const storeyIds = api.GetLineIDsWithType(modelID, WebIFC.IFCBUILDINGSTOREY);
  for (let i = 0; i < storeyIds.size(); i++) {
    const sid = storeyIds.get(i);
    const line = api.GetLine(modelID, sid);
    const name =
      extractString(line.Name) ?? extractString(line.LongName) ?? `Storey_${sid}`;
    storeyName.set(sid, name);
  }

  // Contained-in-spatial-structure: element expressID → storey name
  const elementFloor = new Map<number, string>();
  const relIds = api.GetLineIDsWithType(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
  for (let i = 0; i < relIds.size(); i++) {
    const rel = api.GetLine(modelID, relIds.get(i));
    const relating = rel.RelatingStructure?.value ?? rel.RelatingStructure;
    const floor =
      typeof relating === "number"
        ? storeyName.get(relating) ?? "Unknown"
        : "Unknown";
    const related = rel.RelatedElements ?? [];
    const list = Array.isArray(related) ? related : [];
    for (const el of list) {
      const eid = el?.value ?? el;
      if (typeof eid === "number") elementFloor.set(eid, floor);
    }
  }

  const byGuid = new Map<string, BimComponent>();
  const typeCounts: Record<string, number> = {};
  let geomHits = 0;
  let geomTries = 0;

  for (const { typeId, name } of ELEMENT_TYPE_IDS) {
    const mapped = mapIfcClassToEnum(name);
    if (!mapped) continue;
    let ids: WebIFC.Vector<number>;
    try {
      ids = api.GetLineIDsWithType(modelID, typeId);
    } catch {
      continue;
    }
    const n = ids.size();
    console.log(`  ${name}: ${n}`);
    for (let i = 0; i < n; i++) {
      const expressID = ids.get(i);
      let line: any;
      try {
        line = api.GetLine(modelID, expressID);
      } catch {
        continue;
      }
      const ifcGuid = extractString(line.GlobalId);
      if (!ifcGuid) continue;
      const guid = expressIdToGuid?.get(expressID) ?? ifcGuid;

      // Prefer first occurrence; WallStandardCase may duplicate Wall
      if (byGuid.has(guid)) continue;

      let material: string | null = null;
      let classificationCode: string | null = null;
      try {
        // Property sets via helper when available
        const psets = await api.properties.getPropertySets(modelID, expressID, true);
        for (const ps of psets ?? []) {
          const psetName = extractString(ps.Name) ?? "";
          if (/nl[\s-]?sfb|classification/i.test(psetName)) {
            classificationCode = classificationCode ?? digNlSfb(ps);
          }
          for (const prop of ps.HasProperties ?? []) {
            const pn = extractString(prop.Name) ?? "";
            if (/material/i.test(pn)) material = material ?? extractString(prop.NominalValue) ?? extractString(prop.Value);
            if (/nl[\s-]?sfb|classification|ItemReference/i.test(pn)) {
              classificationCode =
                classificationCode ?? extractString(prop.NominalValue) ?? extractString(prop.Value);
            }
          }
        }
      } catch {
        /* property helper may fail for some entities */
      }

      try {
        const mats = await api.properties.getMaterialsProperties(modelID, expressID, true);
        if (mats?.length) material = material ?? digMaterialName(mats[0]);
      } catch {
        /* optional */
      }

      geomTries++;
      const geometry = computeBoundsFromMesh(api, modelID, expressID) ?? emptyBounds();
      if (geometry !== null && (geometry.min[0] !== 0 || geometry.max[0] !== 0 || geometry.min[1] !== 0)) {
        geomHits++;
      } else if (geometry.min[0] === 0 && geometry.max[0] === 0 && geometry.min[1] === 0 && geometry.max[1] === 0) {
        // still count as miss for all-zero
      } else {
        geomHits++;
      }

      const floorZone = elementFloor.get(expressID) ?? "Unknown";
      typeCounts[mapped] = (typeCounts[mapped] ?? 0) + 1;

      byGuid.set(guid, {
        componentId: guid,
        componentType: mapped as IfcEnumName,
        material,
        classificationCode,
        buildingId,
        geometry,
        floorZone,
        _provenance: {
          componentId: "REAL",
          componentType: "REAL",
          material: "REAL",
          classificationCode: "REAL",
          buildingId: "REAL",
          geometry: "REAL",
          floorZone: "DERIVED",
          note: "floorZone derived from IFC spatial structure hierarchy (IfcRelContainedInSpatialStructure)",
        },
      });
    }
  }

  api.CloseModel(modelID);

  const components = [...byGuid.values()];
  console.log(`IFC components extracted: ${components.length}`);
  console.log(`Geometry hit rate: ${geomTries ? ((geomHits / geomTries) * 100).toFixed(1) : 0}%`);
  console.log("Type counts:", typeCounts);

  writeJson(path.join(DATA, "components.json"), components);

  return {
    components,
    guidSet: new Set(components.map((c) => c.componentId)),
    buildingId,
    typeCounts,
    geometryHitRate: geomTries ? geomHits / geomTries : 0,
  };
}

if (require.main === module) {
  try {
    const { parseSchedule } = require("./parse-schedule");
    const sched = parseSchedule();
    parseIfc(sched.expressIdToGuid).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } catch {
    parseIfc().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
