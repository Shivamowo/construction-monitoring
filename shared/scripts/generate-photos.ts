/**
 * Stream 4: Site engineer photos — JSON records only (placeholder imageRefs).
 * TODO: A human must manually source CC-licensed images into shared/data/photos/
 * matching the placeholder-NNN.jpg filenames. Do NOT scrape/download automatically.
 */
import path from "node:path";
import { DATA, DRONE_FOOTAGE_URL, seededRandom, writeJson } from "./lib/paths";
import type { BimComponent, PredictedMilestoneClass, SiteEngineerPhoto } from "../schema/types";
import type { MilestoneVocabulary } from "../schema/types";

const CLASSES: PredictedMilestoneClass[] = [
  "Framing",
  "MEP",
  "Finishes",
  "Structure",
  "Envelope",
  "Other",
];

export function generatePhotos(
  components: BimComponent[],
  dateMin: string,
  dateMax: string,
  milestoneVocabulary: MilestoneVocabulary,
  count = 80
): SiteEngineerPhoto[] {
  if (!components.length) return [];

  const start = Date.parse(`${dateMin}T12:00:00Z`);
  const end = Date.parse(`${dateMax}T12:00:00Z`);
  const span = Math.max(1, end - start);

  // Prefer components that appear in vocabulary-mapped work
  const photos: SiteEngineerPhoto[] = [];
  for (let i = 0; i < count; i++) {
    const rand = seededRandom(`photo:${i}`);
    const comp = components[Math.floor(rand() * components.length)];
    const ts = new Date(start + rand() * span).toISOString();
    const predictedMilestoneClass =
      CLASSES[Math.floor(rand() * CLASSES.length)] ?? "Other";
    let confidenceScore = 0.4 + rand() * 0.55;
    confidenceScore = Math.round(confidenceScore * 1000) / 1000;
    const humanCorrected = rand() < 0.18;
    const imageRef = `photos/placeholder-${String(i + 1).padStart(3, "0")}.jpg`;

    photos.push({
      photoId: `photo-${String(i + 1).padStart(4, "0")}`,
      timestamp: ts,
      componentId: comp.componentId,
      predictedMilestoneClass,
      confidenceScore,
      humanCorrected,
      imageRef,
      droneFootageRef: DRONE_FOOTAGE_URL,
      _provenance: {
        photoId: "FORGED",
        timestamp: "FORGED",
        componentId: "REAL",
        predictedMilestoneClass: "FORGED",
        confidenceScore: "FORGED",
        humanCorrected: "FORGED",
        imageRef: "FORGED",
        droneFootageRef: "REAL",
        note: "Drone footage URL links to real site aerial videos/images; individual image bounding/milestone tags are forged placeholders.",
      },
    });
  }

  // Soft use of vocabulary to bias a subset toward mapped classes
  const vocabValues = [...new Set(Object.values(milestoneVocabulary))];
  for (let i = 0; i < Math.min(20, photos.length) && vocabValues.length; i++) {
    photos[i].predictedMilestoneClass = vocabValues[i % vocabValues.length];
  }

  writeJson(path.join(DATA, "photos.json"), photos);
  return photos;
}
