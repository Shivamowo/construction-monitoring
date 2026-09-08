import path from "node:path";
import { DATA, DUTCH_TASK_TRANSLATIONS, writeJson } from "./lib/paths";
import type {
  BimComponent,
  MilestoneMappingEntry,
  MilestoneVocabulary,
  PredictedMilestoneClass,
  ProjectMetadata,
} from "../schema/types";

interface MappingResult {
  vocabulary: MilestoneVocabulary;
  unsureTaskNames: string[];
}

/**
 * Map Dutch construction TaskName values onto the six locked buckets.
 * Unsure names are flagged (listed) rather than silently guessed — they still
 * receive a best-effort bucket so the schema remains valid, but are reported.
 */
export function buildMilestoneVocabulary(taskNames: string[]): MappingResult {
  const vocabulary: MilestoneVocabulary = {};
  const unsureTaskNames: string[] = [];

  const rules: Array<{ re: RegExp; bucket: PredictedMilestoneClass; confident: boolean }> = [
    // Structure / concrete
    { re: /stort|bekisten|wapening|fundering|kanaalplaat|breedplaat|opstorten|bruggetjes|werkvloer|liftvloer|liftwand/i, bucket: "Structure", confident: true },
    { re: /prefab beton|betonband/i, bucket: "Structure", confident: true },
    // Framing / steel / load-bearing walls
    { re: /stalen kolom|stalen balk|staalconst|staalconstruct|kalkzandsteen|lijmwerk|stelwerk|metselwerk|scharnierkap/i, bucket: "Framing", confident: true },
    { re: /prefab trap|bordes|opstellen/i, bucket: "Framing", confident: true },
    // Envelope
    { re: /gevel|kozijn|dakbedekking|dakpan|dakraam|dakramen|zink|goot|waterslag|buitenblad|spekband/i, bucket: "Envelope", confident: true },
    { re: /platte dak|dakkapel/i, bucket: "Envelope", confident: true },
    // MEP
    { re: /installateur|nuts|leiding|ventil|riool|cv\b|elek|w-?install/i, bucket: "MEP", confident: true },
    // Finishes
    { re: /afbouw|stuc|schilder|tegel|vloerafwerk|binnenafwerk|afwerk/i, bucket: "Finishes", confident: true },
  ];

  for (const name of taskNames) {
    let matched: PredictedMilestoneClass | null = null;
    let confident = false;
    for (const rule of rules) {
      if (rule.re.test(name)) {
        matched = rule.bucket;
        confident = rule.confident;
        break;
      }
    }
    if (!matched) {
      // Heuristic leftovers
      if (/veiligheid/i.test(name)) {
        matched = "Other";
        confident = true;
      } else if (/randkist/i.test(name)) {
        matched = "Structure";
        confident = true;
      } else {
        matched = "Other";
        confident = false;
        unsureTaskNames.push(name);
      }
    } else if (!confident) {
      unsureTaskNames.push(name);
    }
    vocabulary[name] = matched;
  }

  return { vocabulary, unsureTaskNames };
}

export function generateMetadata(
  components: BimComponent[],
  dateMin: string,
  dateMax: string,
  taskNames: string[],
  buildingId: string
): { metadata: ProjectMetadata; unsureTaskNames: string[] } {
  const zonesList = [...new Set(components.map((c) => c.floorZone).filter(Boolean))].sort();
  const { vocabulary, unsureTaskNames } = buildMilestoneVocabulary(taskNames);

  const milestoneMappingTable: MilestoneMappingEntry[] = Object.entries(vocabulary).map(
    ([dutchTaskName, milestoneClass]) => ({
      dutchTaskName,
      englishTaskName: DUTCH_TASK_TRANSLATIONS[dutchTaskName] ?? dutchTaskName,
      milestoneClass,
    })
  );

  const metadata: ProjectMetadata = {
    projectId: buildingId || "schependomlaan",
    projectName: "Schependomlaan",
    overallTimeline: { start: dateMin, end: dateMax },
    zonesList,
    milestoneVocabulary: vocabulary,
    milestoneMappingTable,
    _provenance: {
      projectId: "REAL",
      projectName: "REAL",
      overallTimeline: "DERIVED",
      zonesList: "DERIVED",
      milestoneVocabulary: "FORGED",
      milestoneMappingTable: "FORGED",
      note: "Milestone vocabulary buckets (Framing, MEP, Finishes, Structure, Envelope, Other) are an engineered classification system; mapping table pairs original Dutch event logs with English translations.",
    },
  };

  writeJson(path.join(DATA, "metadata.json"), metadata);
  if (unsureTaskNames.length) {
    console.warn("Unsure TaskName → milestone mappings (flagged):", unsureTaskNames);
  }
  return { metadata, unsureTaskNames };
}
