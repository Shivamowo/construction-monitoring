/**
 * Opt-in: download illustrative construction JPEGs from Pexels for photos.json imageRefs.
 * Does not modify photos.json provenance — milestone/component links remain FORGED.
 *
 * Requires: PEXELS_API_KEY in the environment (never hardcode).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA, ensureDir } from "./lib/paths";

const PEXELS_SEARCH_API = "https://api.pexels.com/v1/search";
const REQUEST_DELAY_MS = 400;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_RETRIES = 5;
const PER_PAGE = 80;

type MilestoneClass = "Framing" | "MEP" | "Finishes" | "Structure" | "Envelope" | "Other";

interface PhotoRecord {
  photoId: string;
  predictedMilestoneClass: MilestoneClass;
  imageRef: string;
}

interface PexelsPhoto {
  id?: number;
  url?: string | null;
  photographer?: string | null;
  photographer_url?: string | null;
  alt?: string | null;
  src?: {
    original?: string | null;
    large2x?: string | null;
    large?: string | null;
    medium?: string | null;
  } | null;
}

interface SearchResponse {
  photos?: PexelsPhoto[];
  total_results?: number;
}

interface PhotoAttribution {
  photoId: string;
  imageRef: string;
  predictedMilestoneClass: MilestoneClass;
  pexelsPhotoUrl: string | null;
  photographerName: string | null;
  photographerProfileUrl: string | null;
  pexelsPhotoId: number | null;
  mediaUrl: string | null;
  searchTerm: string;
  sha256: string;
}

interface CandidateDownload {
  attribution: PhotoAttribution;
  bytes: Buffer;
}

const SEARCH_TERMS: Record<MilestoneClass, string[]> = {
  Framing: [
    "timber frame construction",
    "wood framing construction",
    "stud wall framing",
    "steel framing construction",
    "construction site",
  ],
  MEP: [
    "electrical conduit installation",
    "HVAC duct installation",
    "plumbing pipe installation",
    "electrical wiring construction",
    "construction site",
  ],
  Finishes: [
    "interior finishing construction",
    "drywall finishing construction",
    "interior painting construction",
    "tile installation construction",
    "construction site",
  ],
  Structure: [
    "concrete structural construction",
    "reinforced concrete construction",
    "concrete formwork construction",
    "rebar construction",
    "construction site",
  ],
  Envelope: [
    "building facade cladding",
    "building facade construction",
    "window installation construction",
    "roof cladding construction",
    "construction site",
  ],
  Other: [
    "construction site general",
    "construction workers site",
    "construction scaffolding",
    "construction equipment site",
    "construction site",
  ],
};

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isJpeg(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  return Math.min(15_000, 500 * 2 ** attempt + Math.floor(Math.random() * 250));
}

function apiKey(): string {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) {
    throw new Error("PEXELS_API_KEY is required to query the Pexels API");
  }
  return key;
}

async function fetchWithRetry(url: string, accept: string, authenticate = false): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: accept,
          ...(authenticate ? { Authorization: apiKey() } : {}),
          "User-Agent": "construction-monitoring-pexels-sourcing/1.0",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) return response;
      if (response.status !== 408 && response.status !== 425 && response.status !== 429 && response.status < 500) {
        throw new Error(`Pexels request failed with HTTP ${response.status}: ${url}`);
      }

      lastError = new Error(`Transient HTTP ${response.status}: ${url}`);
      console.warn(`Retrying after HTTP ${response.status} (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await sleep(retryDelay(response, attempt));
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.message.startsWith("Pexels request failed")) throw error;
      lastError = error;
      await sleep(retryDelay(undefined, attempt));
    }
  }

  throw new Error(`Pexels request failed after ${MAX_RETRIES} attempts: ${String(lastError)}`);
}

async function readResponseBytes(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Image exceeds ${MAX_DOWNLOAD_BYTES} byte limit`);
  }
  if (!response.body) throw new Error("Image response has no body");

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new Error(`Image exceeds ${MAX_DOWNLOAD_BYTES} byte limit`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function mediaUrlFor(photo: PexelsPhoto): string | null {
  const candidates = [photo.src?.large, photo.src?.large2x, photo.src?.original, photo.src?.medium];
  for (const candidate of candidates) {
    if (isHttpUrl(candidate)) return candidate;
  }
  return null;
}

const searchCache = new Map<string, PexelsPhoto[]>();

async function searchPexels(searchTerm: string): Promise<PexelsPhoto[]> {
  const cached = searchCache.get(searchTerm);
  if (cached) return cached;

  const url = new URL(PEXELS_SEARCH_API);
  url.search = new URLSearchParams({
    query: searchTerm,
    per_page: String(PER_PAGE),
    page: "1",
    orientation: "landscape",
  }).toString();

  const response = await fetchWithRetry(url.toString(), "application/json", true);
  const payload = (await response.json()) as SearchResponse;
  const photos = payload.photos ?? [];
  searchCache.set(searchTerm, photos);
  await sleep(REQUEST_DELAY_MS);
  return photos;
}

async function findCandidate(
  photo: PhotoRecord,
  usedIds: Set<number>,
  usedHashes: Set<string>
): Promise<CandidateDownload | null> {
  for (const searchTerm of SEARCH_TERMS[photo.predictedMilestoneClass]) {
    const results = await searchPexels(searchTerm);
    const candidates = results.filter((result) => {
      const id = result.id;
      const pageUrl = result.url?.trim();
      const media = mediaUrlFor(result);
      return (
        typeof id === "number" &&
        Number.isFinite(id) &&
        !usedIds.has(id) &&
        isHttpUrl(pageUrl) &&
        isHttpUrl(media)
      );
    });

    for (const candidate of candidates) {
      const id = candidate.id!;
      const media = mediaUrlFor(candidate)!;
      try {
        const imageResponse = await fetchWithRetry(media, "image/jpeg,image/*;q=0.8,*/*;q=0.1");
        const bytes = await readResponseBytes(imageResponse);
        const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
        if (!isJpeg(bytes) || usedHashes.has(sha256)) {
          console.warn(`Skipping invalid or duplicate Pexels result ${id} for ${photo.photoId}`);
          continue;
        }

        const photographerName = candidate.photographer?.trim() || null;
        const photographerProfileUrl = isHttpUrl(candidate.photographer_url)
          ? candidate.photographer_url.trim()
          : null;
        const pexelsPhotoUrl = isHttpUrl(candidate.url) ? candidate.url.trim() : null;

        return {
          bytes,
          attribution: {
            photoId: photo.photoId,
            imageRef: photo.imageRef,
            predictedMilestoneClass: photo.predictedMilestoneClass,
            pexelsPhotoUrl,
            photographerName,
            photographerProfileUrl,
            pexelsPhotoId: id,
            mediaUrl: media,
            searchTerm,
            sha256,
          },
        };
      } catch (error) {
        console.warn(`Skipping unavailable Pexels result ${id} for ${photo.photoId}: ${String(error)}`);
      } finally {
        await sleep(REQUEST_DELAY_MS);
      }
    }
  }

  return null;
}

function photoPath(photo: PhotoRecord): string {
  const resolved = path.resolve(DATA, photo.imageRef);
  const photosDir = path.resolve(DATA, "photos");
  if (!resolved.startsWith(`${photosDir}${path.sep}`)) {
    throw new Error(`Photo imageRef escapes data/photos: ${photo.imageRef}`);
  }
  return resolved;
}

function validExistingEntry(entry: PhotoAttribution, photo: PhotoRecord): boolean {
  if (
    entry.photoId !== photo.photoId ||
    entry.imageRef !== photo.imageRef ||
    entry.predictedMilestoneClass !== photo.predictedMilestoneClass ||
    entry.pexelsPhotoId == null ||
    !isHttpUrl(entry.pexelsPhotoUrl) ||
    !entry.photographerName ||
    !isHttpUrl(entry.photographerProfileUrl) ||
    !isHttpUrl(entry.mediaUrl) ||
    !entry.searchTerm ||
    !/^[a-f0-9]{64}$/.test(entry.sha256)
  ) {
    return false;
  }
  const imagePath = photoPath(photo);
  if (!fs.existsSync(imagePath)) return false;
  const bytes = fs.readFileSync(imagePath);
  return isJpeg(bytes) && crypto.createHash("sha256").update(bytes).digest("hex") === entry.sha256;
}

function writeAttributions(attributions: PhotoAttribution[]): void {
  const target = path.join(DATA, "photos-attribution.json");
  const temporary = `${target}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(attributions, null, 2)}\n`;
  fs.writeFileSync(temporary, payload, "utf8");
  try {
    // Windows often denies rename-over-existing (EPERM); fall back to copy+unlink.
    if (fs.existsSync(target)) fs.unlinkSync(target);
    fs.renameSync(temporary, target);
  } catch {
    fs.copyFileSync(temporary, target);
    fs.unlinkSync(temporary);
  }
}

function validate(photoRecords: PhotoRecord[], attributions: PhotoAttribution[]): string[] {
  const issues: string[] = [];
  if (photoRecords.length !== 80) issues.push(`Expected 80 photo records, found ${photoRecords.length}`);
  if (attributions.length !== photoRecords.length) {
    issues.push(`Expected ${photoRecords.length} attribution entries, found ${attributions.length}`);
  }

  const photoById = new Map(photoRecords.map((photo) => [photo.photoId, photo]));
  const attributionIds = new Set<string>();
  const attributionRefs = new Set<string>();
  const pexelsIds = new Set<number>();
  const hashes = new Set<string>();

  for (const entry of attributions) {
    const photo = photoById.get(entry.photoId);
    if (!photo) {
      issues.push(`Attribution has unknown photoId: ${entry.photoId}`);
      continue;
    }
    if (attributionIds.has(entry.photoId)) issues.push(`Duplicate attribution photoId: ${entry.photoId}`);
    if (attributionRefs.has(entry.imageRef)) issues.push(`Duplicate attribution imageRef: ${entry.imageRef}`);
    if (entry.pexelsPhotoId != null && pexelsIds.has(entry.pexelsPhotoId)) {
      issues.push(`Duplicate Pexels image: ${entry.pexelsPhotoId}`);
    }
    if (hashes.has(entry.sha256)) issues.push(`Duplicate JPEG content: ${entry.photoId}`);
    attributionIds.add(entry.photoId);
    attributionRefs.add(entry.imageRef);
    if (entry.pexelsPhotoId != null) pexelsIds.add(entry.pexelsPhotoId);
    hashes.add(entry.sha256);

    if (!validExistingEntry(entry, photo)) {
      issues.push(`Invalid asset or attribution metadata for ${entry.photoId}`);
    }
  }

  for (const photo of photoRecords) {
    if (!attributionIds.has(photo.photoId)) issues.push(`Missing attribution for ${photo.photoId}`);
    if (!attributionRefs.has(photo.imageRef)) issues.push(`Missing attribution for ${photo.imageRef}`);
  }

  return issues;
}

function printSummary(attributions: PhotoAttribution[]): void {
  const counts = attributions.reduce<Record<MilestoneClass, number>>(
    (summary, entry) => {
      summary[entry.predictedMilestoneClass] += 1;
      return summary;
    },
    { Framing: 0, MEP: 0, Finishes: 0, Structure: 0, Envelope: 0, Other: 0 }
  );
  const adjustedTerms = attributions.filter(
    (entry) => entry.searchTerm !== SEARCH_TERMS[entry.predictedMilestoneClass][0]
  );

  console.log("\nSourced images by milestone class:");
  for (const [milestoneClass, count] of Object.entries(counts)) {
    console.log(`- ${milestoneClass}: ${count}`);
  }
  console.log(`Adjusted search terms: ${adjustedTerms.length}`);
  for (const entry of adjustedTerms) {
    console.log(`- ${entry.photoId} (${entry.predictedMilestoneClass}): ${entry.searchTerm}`);
  }

  console.log("\nManual review samples:");
  const samples = attributions.filter((_, index) => index % 16 === 0).slice(0, 5);
  for (const entry of samples) {
    console.log(
      `- ${entry.photoId} (${entry.predictedMilestoneClass}) | term="${entry.searchTerm}" | photographer=${entry.photographerName} | id=${entry.pexelsPhotoId} | ${entry.pexelsPhotoUrl}`
    );
  }
}

async function main(): Promise<void> {
  apiKey();
  const photos = loadJson<PhotoRecord[]>(path.join(DATA, "photos.json"));
  const attributionPath = path.join(DATA, "photos-attribution.json");
  const priorAttributions = fs.existsSync(attributionPath)
    ? loadJson<PhotoAttribution[]>(attributionPath)
    : [];
  const validByPhotoId = new Map<string, PhotoAttribution>();

  for (const photo of photos) {
    const matching = priorAttributions.filter((entry) => entry.photoId === photo.photoId);
    if (matching.length === 1 && validExistingEntry(matching[0], photo)) {
      validByPhotoId.set(photo.photoId, matching[0]);
    }
  }

  const attributions = photos
    .map((photo) => validByPhotoId.get(photo.photoId))
    .filter((entry): entry is PhotoAttribution => Boolean(entry));
  const usedIds = new Set(
    attributions
      .map((entry) => entry.pexelsPhotoId)
      .filter((id): id is number => typeof id === "number")
  );
  const usedHashes = new Set(attributions.map((entry) => entry.sha256));
  ensureDir(path.join(DATA, "photos"));

  for (const photo of photos) {
    if (validByPhotoId.has(photo.photoId)) continue;

    const destination = photoPath(photo);
    if (fs.existsSync(destination)) {
      throw new Error(
        `Refusing to overwrite ${photo.imageRef} without a valid matching attribution entry. Move it aside before sourcing.`
      );
    }

    console.log(`Sourcing ${photo.photoId} (${photo.predictedMilestoneClass})...`);
    const result = await findCandidate(photo, usedIds, usedHashes);
    if (!result) {
      throw new Error(
        `No usable Pexels JPEG candidate found for ${photo.photoId} (${photo.predictedMilestoneClass})`
      );
    }

    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, result.bytes);
    fs.renameSync(temporary, destination);
    attributions.push(result.attribution);
    if (result.attribution.pexelsPhotoId != null) usedIds.add(result.attribution.pexelsPhotoId);
    usedHashes.add(result.attribution.sha256);
    writeAttributions(attributions);
  }

  const orderedAttributions = photos.map((photo) => {
    const attribution = attributions.find((entry) => entry.photoId === photo.photoId);
    if (!attribution) throw new Error(`Missing attribution after sourcing ${photo.photoId}`);
    return attribution;
  });
  writeAttributions(orderedAttributions);

  const issues = validate(photos, orderedAttributions);
  if (issues.length) {
    throw new Error(`Photo asset validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
  }

  console.log(`\nValidated ${orderedAttributions.length} JPEG files and attribution entries.`);
  printSummary(orderedAttributions);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
