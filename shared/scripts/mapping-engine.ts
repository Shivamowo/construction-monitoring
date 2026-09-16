/**
 * Mapping engine — pure function: reads a mapping-config.json + a parsed raw
 * object tree (from raw-parsers.ts) and produces canonical
 * `{ plannedSchedule: PlannedTask[], projectMetadata: ProjectMetadata }`.
 *
 * Onboarding a new project = writing one mapping-config.json describing that
 * project's own source shape, NOT writing new parser code. This function
 * never changes per project; only the config does. Unit-testable against a
 * raw tree without touching the dashboard or filesystem.
 */
import type { PlannedTask, PredecessorLinkType, ProjectMetadata } from "../schema/types";
import type { SourceFormat } from "./raw-parsers";

/** The small, fixed vocabulary of value conversions seen so far. Add a new
 * one only when a real project's data actually needs it. */
export type ConverterType =
  | "isoDatetime"
  | "boolIntFlag"
  | "isoDurationToDays"
  | "tenthMinutesToDays"
  | "enum";

export interface FieldMapping {
  path: string;
  type?: ConverterType;
  /** For `type: "enum"` — raw value (stringified) -> output value. */
  map?: Record<string, string>;
  /** For duration/lag converters — the source calendar's minutes-per-day; defaults to 480. */
  minutesPerDay?: number;
}

export interface ArrayFieldMapping {
  path: string;
  isArray: true;
  item: Record<string, FieldMapping>;
}

export interface MappingConfig {
  sourceFormat: SourceFormat;
  /** Dot-notation path to the array (or single item) of task records in the raw tree. */
  taskContainerPath: string;
  /** Skip a raw task record when `field` (dot-notation, relative to the record) stringifies to `equals`. */
  skipIf?: { field: string; equals: string };
  /** Output PlannedTask field name -> where/how to read it from each raw task record. */
  fields: Record<string, FieldMapping | ArrayFieldMapping>;
  /** Output ProjectMetadata field path (dot-notation for nested, e.g. "overallTimeline.start") -> source. */
  projectMetadata: Record<string, FieldMapping>;
}

export interface MappingResult {
  plannedSchedule: PlannedTask[];
  projectMetadata: ProjectMetadata;
}

function isArrayFieldMapping(m: FieldMapping | ArrayFieldMapping): m is ArrayFieldMapping {
  return "isArray" in m && m.isArray === true;
}

/** Walk a dot-notation path through a plain object/array tree. `""` returns the root unchanged. */
function getByPath(obj: unknown, path: string): unknown {
  if (path === "") return obj;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

/** Write a value into a (possibly dot-notation, possibly nested) output path. */
function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cursor = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** ISO 8601 duration like "PT40H0M0S" -> total hours (0 if absent/unparseable). */
function isoDurationToHours(duration: string): number {
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(duration);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours + minutes / 60 + seconds / 3600;
}

function applyConverter(rawValue: unknown, mapping: FieldMapping): unknown {
  if (rawValue === undefined || rawValue === null) return rawValue;
  const minutesPerDay = mapping.minutesPerDay ?? 480;
  switch (mapping.type) {
    case "isoDatetime":
      return String(rawValue).slice(0, 10);
    case "boolIntFlag":
      return String(rawValue) === "1";
    case "isoDurationToDays":
      return isoDurationToHours(String(rawValue)) / (minutesPerDay / 60);
    case "tenthMinutesToDays":
      return Number(rawValue) / 10 / minutesPerDay;
    case "enum":
      return mapping.map?.[String(rawValue)] ?? String(rawValue);
    default:
      return rawValue;
  }
}

function mapRecord(
  record: unknown,
  fields: Record<string, FieldMapping>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [outField, mapping] of Object.entries(fields)) {
    out[outField] = applyConverter(getByPath(record, mapping.path), mapping);
  }
  return out;
}

export function runMappingEngine(
  config: MappingConfig,
  rawTree: unknown
): MappingResult {
  const rawTasks = toArray(getByPath(rawTree, config.taskContainerPath));

  const plannedSchedule: PlannedTask[] = [];
  for (const rawTask of rawTasks) {
    if (config.skipIf) {
      const fieldValue = getByPath(rawTask, config.skipIf.field);
      if (String(fieldValue) === config.skipIf.equals) continue;
    }

    const task: Record<string, unknown> = { weeklyIfcSnapshots: [] };
    for (const [outField, mapping] of Object.entries(config.fields)) {
      if (isArrayFieldMapping(mapping)) {
        const rawItems = toArray(getByPath(rawTask, mapping.path));
        const items = rawItems.map((item) => mapRecord(item, mapping.item));
        if (items.length) task[outField] = items;
      } else {
        task[outField] = applyConverter(getByPath(rawTask, mapping.path), mapping);
      }
    }
    plannedSchedule.push(task as unknown as PlannedTask);
  }

  const projectMetadata: Record<string, unknown> = {
    zonesList: [],
    milestoneVocabulary: {},
    milestoneMappingTable: [],
  };
  for (const [outPath, mapping] of Object.entries(config.projectMetadata)) {
    setByPath(projectMetadata, outPath, applyConverter(getByPath(rawTree, mapping.path), mapping));
  }

  return {
    plannedSchedule,
    projectMetadata: projectMetadata as unknown as ProjectMetadata,
  };
}

// Re-exported so a mapping-config.json author has the type available.
export type { PredecessorLinkType };
