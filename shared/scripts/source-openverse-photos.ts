import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA, ensureDir } from "./lib/paths";

const OPENVERSE_IMAGES_API = "https://api.openverse.org/v1/images/";
const ALLOWED_LICENSES = new Set(["cc0", "by", "by-sa", "pdm"]);
const REQUEST_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_RETRIES = 5;

type MilestoneClass = "Framing" | "MEP" | "Finishes" | "Structure" | "Envelope" | "Other";

interface PhotoRecord {
  photoId: string;
  predictedMilestoneClass: MilestoneClass;
  imageRef: string;
}

interface OpenverseImage {
  id?: string;
  title?: string | null;
  creator?: string | null;
  license?: string | null;
  license_version?: string | null;
  license_url?: string | null;
  foreign_landing_url?: string | null;
  url?: string | null;
  mature?: boolean;
}

interface SearchResponse {
  results?: OpenverseImage[];
}

interface PhotoAttribution {
  photoId: string;
  imageRef: string;
  predictedMilestoneClass: MilestoneClass;
  sourceUrl: string;
  title: string;
  author: string;
  license: string;
  licenseCode: string;
  licenseVersion: string | null;
  licenseUrl: string;
  openverseId: string;
  mediaUrl: string;
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
  ],
  MEP: [
    "electrical conduit installation",
    "HVAC duct installation",
    "plumbing pipe installation",
    "mechanical electrical plumbing construction",
  ],
  Finishes: [
    "interior finishing construction",
    "drywall finishing construction",
    "interior painting construction",
    "tile installation construction",
  ],
  Structure: [
    "concrete structural construction",
    "reinforced concrete construction",
    "concrete formwork construction",
    "rebar construction",
  ],
  Envelope: [
    "building facade cladding",
    "building facade construction",
    "window installation construction",
    "roof cladding construction",
  ],
  Other: [
    "construction site general",
    "construction workers site",
    "construction scaffolding",
    "construction equipment site",
  ],
};

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function asText(value: string | null | undefined): string {
  return value?.trim() || "unknown";
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

function isAllowedLicense(license: string | null | undefined, licenseUrl: string | null | undefined): boolean {
  const code = license?.toLowerCase().trim();
  if (!code || !ALLOWED_LICENSES.has(code) || !isHttpUrl(licenseUrl)) return false;

  const url = new URL(licenseUrl);
  if (url.hostname !== "creativecommons.org" && !url.hostname.endsWith(".creativecommons.org")) {
    return false;
  }

  const licensePath = url.pathname.toLowerCase();
  if (code === "cc0") return licensePath.includes("/publicdomain/zero/");
  if (code === "pdm") return licensePath.includes("/publicdomain/mark/");
  return licensePath.includes(`/licenses/${code}/`);
}

function formatLicense(license: string, version: string | null | undefined): string {
  const cleanVersion = version?.trim();
  if (license === "cc0") return cleanVersion ? `CC0 ${cleanVersion}` : "CC0";
  if (license === "pdm") return cleanVersion ? `Public Domain Mark ${cleanVersion}` : "Public Domain Mark";
  const name = license === "by-sa" ? "CC BY-SA" : "CC BY";
  return cleanVersion ? `${name} ${cleanVersion}` : name;
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

function authorizationHeader(): string {
  const token = process.env.OPENVERSE_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error("OPENVERSE_ACCESS_TOKEN is required to query the Openverse API");
  }
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
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
          ...(authenticate ? { Authorization: authorizationHeader() } : {}),
          "User-Agent": "construction-monitoring-openverse-sourcing/1.0",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) return response;
      if (response.status !== 408 && response.status !== 425 && response.status !== 429 && response.status < 500) {
        throw new Error(`Openverse request failed with HTTP ${response.status}: ${url}`);
      }

      lastError = new Error(`Transient HTTP ${response.status}: ${url}`);
      await sleep(retryDelay(response, attempt));
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.message.startsWith("Openverse request failed")) throw error;
      lastError = error;
      await sleep(retryDelay(undefined, attempt));
    }
  }

  throw new Error(`Openverse request failed after ${MAX_RETRIES} attempts: ${String(lastError)}`);
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

async function findCandidate(
  photo: PhotoRecord,
  usedIds: Set<string>,
  usedSources: Set<string>,
  usedHashes: Set<string>
): Promise<CandidateDownload | null> {
  for (const searchTerm of SEARCH_TERMS[photo.predictedMilestoneClass]) {
    const url = new URL(OPENVERSE_IMAGES_API);
    url.search = new URLSearchParams({
      q: searchTerm,
      license: "cc0,by,by-sa,pdm",
      extension: "jpg",
      mature: "false",
      page_size: "40",
    }).toString();

    const response = await fetchWithRetry(url.toString(), "application/json", true);
    const payload = (await response.json()) as SearchResponse;
    const candidates = (payload.results ?? []).filter((result) => {
      const id = result.id?.trim();
      const sourceUrl = result.foreign_landing_url?.trim();
      const mediaUrl = result.url?.trim();
      return (
        Boolean(id) &&
        isHttpUrl(sourceUrl) &&
        isHttpUrl(mediaUrl) &&
        !result.mature &&
        isAllowedLicense(result.license, result.license_url) &&
        !usedIds.has(id!) &&
        !usedSources.has(sourceUrl)
      );
    });

    for (const candidate of candidates) {
      const id = candidate.id!.trim();
      const sourceUrl = candidate.foreign_landing_url!.trim();
      const mediaUrl = candidate.url!.trim();
      try {
        const imageResponse = await fetchWithRetry(mediaUrl, "image/jpeg,image/*;q=0.8,*/*;q=0.1");
        const bytes = await readResponseBytes(imageResponse);
        const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
        if (!isJpeg(bytes) || usedHashes.has(sha256)) {
          console.warn(`Skipping invalid or duplicate Openverse result ${id} for ${photo.photoId}`);
          continue;
        }

        const licenseCode = candidate.license!.toLowerCase().trim();
        return {
          bytes,
          attribution: {
            photoId: photo.photoId,
            imageRef: photo.imageRef,
            predictedMilestoneClass: photo.predictedMilestoneClass,
            sourceUrl,
            title: asText(candidate.title),
            author: asText(candidate.creator),
            license: formatLicense(licenseCode, candidate.license_version),
            licenseCode,
            licenseVersion: candidate.license_version?.trim() || null,
            licenseUrl: candidate.license_url!.trim(),
            openverseId: id,
            mediaUrl,
            searchTerm,
            sha256,
          },
        };
      } catch (error) {
        console.warn(`Skipping unavailable Openverse result ${id} for ${photo.photoId}: ${String(error)}`);
      }
    }

    await sleep(REQUEST_DELAY_MS);
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
    !entry.openverseId ||
    !isHttpUrl(entry.sourceUrl) ||
    !isHttpUrl(entry.mediaUrl) ||
    !isAllowedLicense(entry.licenseCode, entry.licenseUrl) ||
    !entry.title ||
    !entry.author ||
    !entry.license ||
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
  fs.writeFileSync(temporary, `${JSON.stringify(attributions, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
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
  const openverseIds = new Set<string>();
  const sourceUrls = new Set<string>();
  const hashes = new Set<string>();

  for (const entry of attributions) {
    const photo = photoById.get(entry.photoId);
    if (!photo) {
      issues.push(`Attribution has unknown photoId: ${entry.photoId}`);
      continue;
    }
    if (attributionIds.has(entry.photoId)) issues.push(`Duplicate attribution photoId: ${entry.photoId}`);
    if (attributionRefs.has(entry.imageRef)) issues.push(`Duplicate attribution imageRef: ${entry.imageRef}`);
    if (openverseIds.has(entry.openverseId)) issues.push(`Duplicate Openverse image: ${entry.openverseId}`);
    if (sourceUrls.has(entry.sourceUrl)) issues.push(`Duplicate source URL: ${entry.sourceUrl}`);
    if (hashes.has(entry.sha256)) issues.push(`Duplicate JPEG content: ${entry.photoId}`);
    attributionIds.add(entry.photoId);
    attributionRefs.add(entry.imageRef);
    openverseIds.add(entry.openverseId);
    sourceUrls.add(entry.sourceUrl);
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
  for (const entry of adjustedTerms.slice(0, 10)) {
    console.log(`- ${entry.photoId}: ${entry.searchTerm}`);
  }

  console.log("\nManual review samples:");
  for (const entry of attributions.filter((_, index) => index % 16 === 0).slice(0, 5)) {
    console.log(
      `- ${entry.photoId} (${entry.predictedMilestoneClass}) | ${entry.searchTerm} | ${entry.title} | ${entry.license} | ${entry.sourceUrl}`
    );
  }
}

async function main(): Promise<void> {
  authorizationHeader();
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
  const usedIds = new Set(attributions.map((entry) => entry.openverseId));
  const usedSources = new Set(attributions.map((entry) => entry.sourceUrl));
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
    const result = await findCandidate(photo, usedIds, usedSources, usedHashes);
    if (!result) {
      throw new Error(`No valid CC-licensed JPEG candidate found for ${photo.photoId} (${photo.predictedMilestoneClass})`);
    }

    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, result.bytes);
    fs.renameSync(temporary, destination);
    attributions.push(result.attribution);
    usedIds.add(result.attribution.openverseId);
    usedSources.add(result.attribution.sourceUrl);
    usedHashes.add(result.attribution.sha256);
    writeAttributions(attributions);
    await sleep(REQUEST_DELAY_MS);
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
