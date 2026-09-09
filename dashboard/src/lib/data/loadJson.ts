import fs from "node:fs";
import path from "node:path";

/** Absolute path to monorepo `shared/data`. */
export function sharedDataDir(): string {
  return path.join(process.cwd(), "..", "shared", "data");
}

export function loadJsonFile<T>(filename: string): T {
  const filePath = path.join(sharedDataDir(), filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing data file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}
