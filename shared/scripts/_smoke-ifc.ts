import fs from "fs";
import path from "path";
import * as WebIFC from "web-ifc";

async function main() {
  const api = new WebIFC.IfcAPI();
  const wasmDir = path.dirname(require.resolve("web-ifc"));
  console.log("wasmDir", wasmDir);
  await api.Init((file: string) => path.join(wasmDir, file));
  const buf = fs.readFileSync("../raw-data/Design model IFC/IFC Schependomlaan.ifc");
  console.log("IFC bytes", buf.length);
  const id = api.OpenModel(new Uint8Array(buf));
  console.log("modelID", id);
  const walls = api.GetLineIDsWithType(id, WebIFC.IFCWALL);
  const wallStd = api.GetLineIDsWithType(id, WebIFC.IFCWALLSTANDARDCASE);
  console.log("walls", walls.size(), "wallStd", wallStd.size());
  const types = api.GetAllTypesOfModel(id);
  console.log("type count", types.length);
  console.log(types.slice(0, 25).map((t: { typeName: string }) => t.typeName).join(", "));
  if (walls.size() > 0) {
    const eid = walls.get(0);
    const line = api.GetLine(id, eid);
    console.log("sample GlobalId", line.GlobalId);
    const mesh = api.GetFlatMesh(id, eid);
    console.log("geoms", mesh.geometries.size());
  } else if (wallStd.size() > 0) {
    const eid = wallStd.get(0);
    const line = api.GetLine(id, eid);
    console.log("sample GlobalId", line.GlobalId);
  }
  api.CloseModel(id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
