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
import type {
  AsBuiltDeviation,
  DeviationDaysSource,
  FusionOutput,
  Milestone,
  PlannedTask,
  PredecessorLinkType,
  ProjectMetadata,
} from "../schema/types";
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

/**
 * Declarative rule for deriving Milestone records from the SAME raw task
 * array a project's schedule tasks come from (read before `skipIf` removes
 * summary rows) — no separate parser code per format. A raw record is a
 * milestone when `summaryFlagField` equals `summaryFlagValue` AND its own
 * immediate next record (in document order) is one level deeper on
 * `hierarchyField` and is itself a LEAF (not a summary) — this distinguishes
 * a real phase header (e.g. MSPDI "Engineering", whose children are leaf
 * tasks) from a project-root wrapper node (whose "children" are further
 * summary nodes) without hardcoding outline-level numbers for any format.
 * Members are every subsequent leaf record until the next record at the
 * milestone's own hierarchy depth or shallower.
 */
export interface MilestoneExtractionConfig {
  summaryFlagField: string;
  summaryFlagValue: string;
  hierarchyField: string;
  idField: string;
  nameField: string;
  startField: string;
  endField: string;
}

/**
 * Declarative rule for deriving REAL/DERIVED AsBuiltDeviation + FusionOutput
 * records straight from a source schedule's own Actual* fields — no BIM/
 * point-cloud layer required. A task counts as "not started" (no record
 * emitted at all — it's simply a future waypoint, not a deviation) when
 * `actualEndField` is absent or stringifies to `notStartedValue`. Otherwise
 * it's finished: deviationDays = days between its planned end and its real
 * actual end (0 if on time or ahead), onTimeStatus/deviationFlag derived
 * from the sign of that difference. componentId on both records is the
 * task's own id (schedule-only projects have no Stream 1 componentId to
 * key by), matching the same fallback aggregate.ts already uses.
 */
export interface AsBuiltExtractionConfig {
  actualEndField: string;
  notStartedValue: string;
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
  /** Absent -> milestones: [] (e.g. Schependomlaan, which has no phase/summary structure). */
  milestones?: MilestoneExtractionConfig;
  /** Absent -> fusionOutputs/asBuiltDeviations: [] (e.g. a purely baseline/not-yet-started schedule). */
  asBuilt?: AsBuiltExtractionConfig;
}

export interface MappingResult {
  plannedSchedule: PlannedTask[];
  projectMetadata: ProjectMetadata;
  milestones: Milestone[];
  fusionOutputs: FusionOutput[];
  asBuiltDeviations: AsBuiltDeviation[];
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

/**
 * Extract Milestone records from the raw (unfiltered) task array. Operates
 * on document order and a hierarchy field only — no per-format hardcoding.
 * isCriticalPath/totalSlackDays/rootCause are intentionally NOT computed
 * here (left as neutral defaults); they're DERIVED at request time in
 * aggregate.ts by cross-referencing the final plannedSchedule, same place
 * the equivalent per-task-group rollup already happens.
 */
function extractMilestones(
  rawTasks: unknown[],
  config: MilestoneExtractionConfig
): Milestone[] {
  const isSummary = (t: unknown) =>
    String(getByPath(t, config.summaryFlagField)) === config.summaryFlagValue;
  const level = (t: unknown) => Number(getByPath(t, config.hierarchyField));

  const milestones: Milestone[] = [];
  for (let i = 0; i < rawTasks.length; i++) {
    const task = rawTasks[i];
    if (!isSummary(task)) continue;
    const next = rawTasks[i + 1];
    if (next === undefined) continue;
    const myLevel = level(task);
    if (!(level(next) === myLevel + 1 && !isSummary(next))) continue; // not a phase header

    const memberTaskIds: string[] = [];
    for (let j = i + 1; j < rawTasks.length; j++) {
      if (level(rawTasks[j]) <= myLevel) break;
      if (!isSummary(rawTasks[j])) {
        memberTaskIds.push(String(getByPath(rawTasks[j], config.idField)));
      }
    }

    milestones.push({
      milestoneId: String(getByPath(task, config.idField)),
      milestoneName: String(getByPath(task, config.nameField)),
      plannedStart: String(getByPath(task, config.startField)).slice(0, 10),
      plannedEnd: String(getByPath(task, config.endField)).slice(0, 10),
      memberTaskIds,
      isCriticalPath: false,
      totalSlackDays: null,
    });
  }
  return milestones;
}

/** Whole-day difference: positive means `actualEnd` is later than `plannedEnd`. */
function daysBetween(plannedEndIso: string, actualEndIso: string): number {
  const ms = Date.parse(`${actualEndIso}T00:00:00Z`) - Date.parse(`${plannedEndIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function runMappingEngine(
  config: MappingConfig,
  rawTree: unknown
): MappingResult {
  const rawTasks = toArray(getByPath(rawTree, config.taskContainerPath));

  const milestones = config.milestones
    ? extractMilestones(rawTasks, config.milestones)
    : [];

  const plannedSchedule: PlannedTask[] = [];
  const fusionOutputs: FusionOutput[] = [];
  const asBuiltDeviations: AsBuiltDeviation[] = [];
  const asBuiltConfig = config.asBuilt;

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

    if (asBuiltConfig) {
      const actualEndRaw = getByPath(rawTask, asBuiltConfig.actualEndField);
      const notStarted =
        actualEndRaw === undefined ||
        actualEndRaw === null ||
        String(actualEndRaw) === asBuiltConfig.notStartedValue;
      if (notStarted) continue; // future waypoint — no deviation/fusion record, not a "not_scheduled" case

      const actualEndIso = String(actualEndRaw).slice(0, 10);
      const plannedEndIso = String(task.plannedEnd);
      const rawDelta = daysBetween(plannedEndIso, actualEndIso);
      const onTimeStatus = rawDelta > 0 ? "too_late" : "on_time";
      const deviationFlag = rawDelta > 0 ? "behind" : rawDelta < 0 ? "ahead" : "on_time";
      const componentId = String(task.taskId);

      asBuiltDeviations.push({
        componentId,
        onTimeStatus,
        deviationDays: Math.max(0, rawDelta),
        deviationDaysSource: "derived" as DeviationDaysSource,
      });
      fusionOutputs.push({
        componentId,
        completionPct: 100,
        deviationFlag,
        lastUpdated: actualEndIso,
      });
    }
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
    milestones,
    fusionOutputs,
    asBuiltDeviations,
  };
}

// Re-exported so a mapping-config.json author has the type available.
export type { PredecessorLinkType };
