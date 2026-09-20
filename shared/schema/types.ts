/**
 * Shared schema for the construction progress monitoring system.
 * Single source of truth for dashboard/ and 3d-twin/.
 *
 * Field provenance tags (in JSDoc above each field):
 * - REAL    — directly from the Schependomlaan (or related) real dataset
 * - DERIVED — computed/aggregated from real data
 * - FORGED  — fully synthetic; generated in Phase 2
 */

/** The 14 real IFC classes present in the Schependomlaan BIM model. */
export type IfcComponentType =
  | "Beam"
  | "Building Element Proxy"
  | "Column"
  | "Covering"
  | "Distribution Element"
  | "Door"
  | "Member"
  | "Pipe Segment"
  | "Railing"
  | "Roof"
  | "Slab"
  | "Stair"
  | "Wall"
  | "Window";

export type OnTimeStatus = "on_time" | "too_late" | "unknown";

export type DeviationFlag = "ahead" | "on_time" | "behind" | "not_scheduled";

/**
 * Placeholder vocabulary locked to six PredictedMilestoneClass buckets.
 * This vocabulary is LOCKED specifically for BIM-linked BUILDING projects
 * (Schependomlaan-shaped data) — schedule-only, non-building projects (e.g.
 * a substation/infrastructure schedule with no natural mapping onto
 * Framing/MEP/Finishes/Structure/Envelope) must NOT force-fit their tasks
 * into these buckets (don't mis-map "Civil Works" into "Structure"). Such
 * projects should leave milestone/predictedMilestoneClass fields unset and
 * skip milestone auto-classification entirely until a second real
 * non-building project's shape justifies a proper vocabulary extension —
 * same "don't build it blind" principle as deferring Phase 2 of the
 * layout-engine plan until more real data shapes are seen.
 */
export type PredictedMilestoneClass =
  | "Framing"
  | "MEP"
  | "Finishes"
  | "Structure"
  | "Envelope"
  | "Other";

/** CPM predecessor link type: Finish-to-Start, Start-to-Start, Finish-to-Finish, Start-to-Finish. */
export type PredecessorLinkType = "FS" | "SS" | "FF" | "SF";

/** Which path produced deviationDays for an AsBuiltDeviation record. */
export type DeviationDaysSource = "derived" | "forged";

export type ReviewStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "needs_review";

export type ViolationType =
  | "no_hard_hat"
  | "no_safety_vest"
  | "no_harness"
  | "restricted_zone"
  | "other";

export type Severity = "low" | "medium" | "high" | "critical";

export type ResolutionStatus =
  | "open"
  | "acknowledged"
  | "resolved"
  | "dismissed";

/** Axis-aligned bounding box / spatial reference extracted from IFC. */
export interface GeometryBounds {
  /** REAL — min corner XYZ from IFC geometry */
  min: [number, number, number];
  /** REAL — max corner XYZ from IFC geometry */
  max: [number, number, number];
  /** REAL — optional centroid if available from IFC extraction */
  centroid?: [number, number, number];
}

export type ProvenanceTag = "REAL" | "DERIVED" | "FORGED";

/** Stream 1: BIM / Design Reference */
export interface BimComponent {
  /** REAL — IFC component GUID */
  componentId: string;
  /** REAL — one of the 14 real IFC classes in Schependomlaan */
  componentType: IfcComponentType;
  /** REAL — material name/string from IFC; null if absent */
  material: string | null;
  /** REAL — Nl-sfb classification code; null if absent */
  classificationCode: string | null;
  /** REAL — building identifier from the model */
  buildingId: string;
  /** REAL — spatial coordinates / bounding reference extracted from IFC */
  geometry: GeometryBounds;
  /** DERIVED — human-readable floor/zone label from IFC spatial hierarchy */
  floorZone: string;
  /** Field-level provenance classification */
  _provenance?: Record<string, ProvenanceTag | string>;
}

/** Stream 2: Planned Schedule */
export interface PlannedTask {
  /** REAL — task identifier from construction event logs */
  taskId: string;
  /** REAL — task name (source data is in Dutch) */
  taskName: string;
  /** DERIVED — English translation alongside original Dutch taskName */
  taskNameEn: string;
  /** REAL — planned start date (ISO 8601 date) */
  plannedStart: string;
  /** REAL — planned end date (ISO 8601 date) */
  plannedEnd: string;
  /**
   * REAL — foreign key to Stream 1 `componentId`; absent for schedule-only
   * projects with no BIM/spatial layer.
   */
  componentId?: string;
  /** REAL — weekly IFC snapshot filenames associated with this task's timeline */
  weeklyIfcSnapshots: string[];
  /** REAL — predecessor task dependencies from source schedule (CPM), when available */
  predecessors?: { taskId: string; type: PredecessorLinkType; lagDays: number }[];
  /** REAL — true if this task sits on the critical path per source schedule */
  isCriticalPath?: boolean;
  /** REAL — total float/slack in days per source schedule; null if not computed by source */
  totalSlackDays?: number | null;
  /** Field-level provenance classification */
  _provenance?: Record<string, ProvenanceTag | string>;
}

/** Stream 3: Deviation / As-Built */
export interface AsBuiltDeviation {
  /**
   * REAL — foreign key to Stream 1 `componentId`; absent for schedule-only
   * projects with no BIM/spatial layer.
   */
  componentId?: string;
  /** REAL — as-built on-time / too-late flag from event logs */
  onTimeStatus: OnTimeStatus;
  /**
   * DERIVED — if computable from planned vs actual dates in source logs;
   * FORGED — if dates are insufficient and the value is synthesized in Phase 2.
   * Nullable when unknown.
   */
  deviationDays: number | null;
  /** Which path produced `deviationDays` for this record. */
  deviationDaysSource: DeviationDaysSource;
  /**
   * FORGED — comparison_all_weeks.xlsx lists missing elements per week
   * (Name/GUID/GlobalID columns) and does NOT provide per-component volumetric
   * deviation percentages; values are synthesized in Phase 2. Absent for
   * schedule-only projects with no point-cloud/BIM layer at all (a real
   * schedule-derived deviation from Actual* dates has no volumetric basis).
   */
  volumetricDeviationPct?: number;
  /** REAL — path/reference to the associated point-cloud file; absent for schedule-only projects. */
  pointCloudRef?: string;
  /** FORGED — synthetic confidence score for the point-cloud match (0–1); absent for schedule-only projects. */
  pointCloudConfidence?: number;
  /** FORGED — 2D grid of deviation values per zone (synthetic heatmap); absent for schedule-only projects. */
  heatmapGrid?: number[][];
  /** Field-level provenance classification */
  _provenance?: Record<string, ProvenanceTag | string>;
}

/** Stream 4: Site Engineer Photos */
export interface SiteEngineerPhoto {
  /**
   * FORGED — synthetic photo id; underlying image may be an unrelated
   * real CC-licensed photo reused in Phase 2.
   */
  photoId: string;
  /** FORGED — synthetic capture timestamp (ISO 8601 datetime) */
  timestamp: string;
  /**
   * FORGED — synthetic link to Stream 1 `componentId`; absent for
   * schedule-only projects with no BIM/spatial layer.
   */
  componentId?: string;
  /** FORGED — predicted construction milestone class */
  predictedMilestoneClass: PredictedMilestoneClass;
  /** FORGED — model confidence for the predicted class (0–1) */
  confidenceScore: number;
  /** FORGED — whether a human corrected the automatic label */
  humanCorrected: boolean;
  /**
   * REAL — the image file itself may be a real CC-licensed asset;
   * FORGED — its label/tagging and component association are synthetic.
   */
  imageRef: string;
  /** REAL — external link to original drone footage repository */
  droneFootageRef?: string;
  /** Field-level provenance classification */
  _provenance?: Record<string, ProvenanceTag | string>;
}

/** Stream 5: Fusion Layer Output */
export interface FusionOutput {
  /**
   * REAL — foreign key to Stream 1 `componentId`; absent for schedule-only
   * projects with no BIM/spatial layer.
   */
  componentId?: string;
  /** DERIVED — aggregated completion % from Stream 2 task history (0–100) */
  completionPct: number;
  /**
   * FORGED — synthetic confidence-weighted fusion score (0–1); absent for
   * schedule-only projects where deviationFlag comes straight from real
   * Actual* schedule dates (nothing to weight a confidence over).
   */
  confidenceWeightedScore?: number;
  /** DERIVED — schedule position relative to plan */
  deviationFlag: DeviationFlag;
  /** REAL/DERIVED — real Actual* date when computed from a source schedule; FORGED synthetic timestamp otherwise. */
  lastUpdated: string;
  /** FORGED — synthetic human/process review status; absent for schedule-only projects. */
  reviewStatus?: ReviewStatus;
  /** Field-level provenance classification */
  _provenance?: Record<string, ProvenanceTag | string>;
}

/** Stream 6: Safety / PPE (entire stream is FORGED) */
export interface SafetyDetection {
  /** FORGED — synthetic detection id (no real basis) */
  detectionId: string;
  /** FORGED — synthetic detection timestamp (ISO 8601 datetime) */
  timestamp: string;
  /** FORGED — synthetic site zone label */
  zone: string;
  /** FORGED / DERIVED — component in this zone where the safety event was observed */
  componentId?: string;
  /** FORGED — type of PPE / safety violation */
  violationType: ViolationType;
  /** FORGED — severity of the violation */
  severity: Severity;
  /** FORGED — detector confidence (0–1) */
  confidenceScore: number;
  /** FORGED — whether/how the finding was resolved */
  resolutionStatus: ResolutionStatus;
  /** Field-level provenance classification */
  _provenance?: Record<string, ProvenanceTag | string>;
}

/**
 * A specific member task identified as the driver of a milestone's delay
 * (or delay risk). DERIVED, never a narrative/human-language cause — there
 * is no source field anywhere in current data for a human-written "why".
 */
export interface MilestoneRootCause {
  /** REAL — the specific member task's own id, from Stream 2. */
  taskId: string;
  /** REAL — the specific member task's own name. */
  taskName: string;
  /**
   * DERIVED — factual, structural statement of what is driving the delay:
   * a critical-path task already behind its planned end (as-built known),
   * or a critical-path task with zero float that has not slipped yet
   * (forecast-only, nothing measured so far). Never a fabricated cause.
   */
  reason: string;
}

/**
 * Stream 2 addendum: a project-specific checkpoint derived from the
 * source schedule's own phase/summary structure (e.g. MSPDI Summary=1
 * rows), NOT the locked PredictedMilestoneClass vocabulary. Populated only
 * for schedule formats whose mapping-config declares a milestone
 * extraction rule; absent (empty array) for projects without one, e.g.
 * Schependomlaan.
 */
export interface Milestone {
  /** REAL — id of the source schedule's own summary/phase task. */
  milestoneId: string;
  /** REAL — name of the source schedule's own summary/phase task. */
  milestoneName: string;
  /** REAL — the summary task's own rolled-up start, as computed by the source tool. */
  plannedStart: string;
  /** REAL — the summary task's own rolled-up end, as computed by the source tool. */
  plannedEnd: string;
  /** REAL — leaf PlannedTask.taskId values this milestone aggregates. */
  memberTaskIds: string[];
  /** DERIVED — true if ANY member task is on the critical path. */
  isCriticalPath: boolean;
  /** DERIVED — MIN totalSlackDays across member tasks; null if none carry slack data. */
  totalSlackDays: number | null;
  /**
   * DERIVED — populated only when this milestone itself is at risk
   * (isCriticalPath && totalSlackDays === 0) or already delayed (a member
   * is behind per as-built data). Absent otherwise.
   */
  rootCause?: MilestoneRootCause[];
}

/** Overall project timeline derived from schedule extents. */
export interface OverallTimeline {
  /** DERIVED — earliest plannedStart across Stream 2 */
  start: string;
  /** DERIVED — latest plannedEnd across Stream 2 */
  end: string;
}

/**
 * Maps raw Dutch task names (keys) onto the six locked PredictedMilestoneClass buckets.
 * Buckets are FINAL and LOCKED — not an open/TBD vocabulary.
 */
export type MilestoneVocabulary = Record<string, PredictedMilestoneClass>;

/** Auditable milestone mapping record. */
export interface MilestoneMappingEntry {
  dutchTaskName: string;
  englishTaskName: string;
  milestoneClass: PredictedMilestoneClass;
}

/** Stream 7: Project Metadata */
export interface ProjectMetadata {
  /** REAL — project identifier */
  projectId: string;
  /** REAL — project display name */
  projectName: string;
  /** DERIVED — min/max of Stream 2 planned dates */
  overallTimeline: OverallTimeline;
  /**
   * REAL — the schedule's own status date ("as of" date), when the source
   * format carries one (MSPDI `Project/StatusDate`). Absent for sources that
   * don't publish one, in which case the navigator falls back to deriving an
   * asOf from the frontier of measured data — see aggregate.ts.
   */
  statusDate?: string;
  /** DERIVED — distinct zone labels from IFC spatial hierarchy */
  zonesList: string[];
  /**
   * DERIVED mapping — maps real Dutch TaskName values from the schedule logs
   * onto the six locked PredictedMilestoneClass buckets.
   */
  milestoneVocabulary: MilestoneVocabulary;
  /**
   * Auditable mapping table pairing Dutch task names, English translations,
   * and locked milestone buckets.
   */
  milestoneMappingTable: MilestoneMappingEntry[];
  /** Field-level provenance classification */
  _provenance?: Record<string, ProvenanceTag | string>;
}

/**
 * SKELETON — recovery-plan shape. No real sample export from the external
 * recovery-plan tool has been seen yet; every field below is a provisional
 * best-guess placeholder, NOT a contract to build the real ingestion
 * against. When a real sample lands: delete whatever guessed fields don't
 * actually appear, add whatever real ones do, and only then wire this into
 * the schedule (see shared/scripts/ingest-recovery-plan.ts). Do not extend
 * `buildScheduleNavigatorPayload` or any UI to consume this until then.
 */
export interface RecoveryPlanRevisedTask {
  /** Foreign key back to Stream 2 PlannedTask.taskId. */
  taskId: string;
  newPlannedStart: string;
  newPlannedEnd: string;
  newIsCriticalPath?: boolean;
  newTotalSlackDays?: number | null;
}

/** SKELETON — see RecoveryPlanRevisedTask; not a finished contract. */
export interface RecoveryPlan {
  recoveryPlanId: string;
  /** ISO 8601 datetime the recovery route was adopted/applied. */
  appliedAt: string;
  /** Reference/link back to the external recovery-plan tool's own record, if it provides one. */
  sourceRef?: string;
  revisedTasks: RecoveryPlanRevisedTask[];
  /** Verbatim note from the recovery-plan tool, if it provides one — never fabricated. */
  note?: string;
}

/** Convenience bundle of all streams for typed loaders (optional). */
export interface ConstructionMonitoringDataset {
  /** Semver of this schema/data contract */
  schemaVersion: string;
  /** ISO 8601 datetime when this data bundle was generated */
  generatedAt: string;
  bimComponents: BimComponent[];
  plannedSchedule: PlannedTask[];
  asBuiltDeviations: AsBuiltDeviation[];
  siteEngineerPhotos: SiteEngineerPhoto[];
  fusionOutputs: FusionOutput[];
  safetyDetections: SafetyDetection[];
  projectMetadata: ProjectMetadata;
  _provenance?: Record<string, ProvenanceTag | string>;
}
