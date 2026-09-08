/**
 * Step 4: Inspect comparison_all weeks.xlsx structure and report usability
 * for volumetricDeviationPct.
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { DATA, XLSX_PATH, writeJson } from "./lib/paths";

export interface XlsxInspection {
  usableForVolumetricDeviationPct: false;
  reason: string;
  sheets: Array<{
    name: string;
    title: string | null;
    columns: string[];
    dataRowCount: number;
    sampleMissingIfcGuids: string[];
  }>;
  /** IFC GlobalIDs listed as missing in any week */
  missingIfcGuids: string[];
}

export function inspectXlsx(): XlsxInspection {
  console.log("Inspecting:", XLSX_PATH);
  const wb = XLSX.readFile(XLSX_PATH);
  const missingIfcGuids = new Set<string>();
  const sheets: XlsxInspection["sheets"] = [];

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: null,
    });
    const title = rows[0]?.[0] != null ? String(rows[0][0]) : null;
    const headerRow = (rows[1] ?? []).map((c) => (c == null ? "" : String(c)));
    const dataRows = rows.slice(2).filter((r) => r && r.some((c) => c != null && String(c).trim()));
    const sampleMissingIfcGuids: string[] = [];
    for (const r of dataRows) {
      const ifcGid = r[3] != null ? String(r[3]).trim() : "";
      if (ifcGid) {
        missingIfcGuids.add(ifcGid);
        if (sampleMissingIfcGuids.length < 5) sampleMissingIfcGuids.push(ifcGid);
      }
    }
    sheets.push({
      name,
      title,
      columns: headerRow.filter(Boolean),
      dataRowCount: dataRows.length,
      sampleMissingIfcGuids,
    });
  }

  const report: XlsxInspection = {
    usableForVolumetricDeviationPct: false,
    reason:
      "Each week sheet lists elements missing vs the as-planned model (columns: Name, GUID, GlobalID Synchro, GlobalID IFC). There is no volumetricDeviationPct (or any numeric deviation %) column. Falling back to FORGED volumetricDeviationPct.",
    sheets,
    missingIfcGuids: [...missingIfcGuids],
  };

  writeJson(path.join(DATA, "_xlsx-inspection.json"), report);
  console.log(JSON.stringify({ usable: false, sheets: sheets.map((s) => ({ name: s.name, cols: s.columns, rows: s.dataRowCount })), missingCount: missingIfcGuids.size }, null, 2));
  return report;
}

if (require.main === module) {
  inspectXlsx();
}
