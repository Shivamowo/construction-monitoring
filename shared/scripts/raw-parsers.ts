/**
 * Raw parsers — one per `sourceFormat`. Each is "bytes in -> JS object tree
 * out" with NO field-name knowledge of any particular project's schema;
 * all field knowledge lives in that project's mapping-config.json and is
 * applied later by mapping-engine.ts. Adding a new source format later is
 * one small parser function here, not a change to the mapping engine.
 */
import fs from "node:fs";
import Papa from "papaparse";
import { XMLParser } from "fast-xml-parser";

export type SourceFormat = "mspdi-xml" | "csv" | "json";

/** MSPDI/MS-Project XML -> nested object tree (e.g. `{ Project: { Tasks: { Task: [...] } } }`). */
function parseMspdiXml(raw: string): unknown {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: true,
    parseAttributeValue: true,
  });
  return parser.parse(raw);
}

/** CSV -> `{ rows: Record<string,string>[] }` (one object per row, keyed by header). */
function parseCsv(raw: string): unknown {
  const parsed = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  if (parsed.errors.length) {
    console.warn("CSV parse warnings:", parsed.errors.slice(0, 5));
  }
  return { rows: parsed.data };
}

/** JSON -> passthrough (already a JS object tree). */
function parseJson(raw: string): unknown {
  return JSON.parse(raw);
}

const PARSERS: Record<SourceFormat, (raw: string) => unknown> = {
  "mspdi-xml": parseMspdiXml,
  csv: parseCsv,
  json: parseJson,
};

export function parseRawFile(filePath: string, sourceFormat: SourceFormat): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  const parser = PARSERS[sourceFormat];
  if (!parser) {
    throw new Error(`No raw parser registered for sourceFormat "${sourceFormat}"`);
  }
  return parser(raw);
}
