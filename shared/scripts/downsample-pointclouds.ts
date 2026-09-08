/**
 * Step 6: Voxel-downsample real PLY point clouds (~90–95% reduction).
 * Hand-rolled grid-based averaging (no Python).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { DATA, POINT_CLOUDS_DIR, ensureDir } from "./lib/paths";

interface VoxelAcc {
  x: number;
  y: number;
  z: number;
  n: number;
  r?: number;
  g?: number;
  b?: number;
}

export async function downsamplePlyFile(
  inputPath: string,
  outputPath: string,
  voxelSize: number,
  sourceDesc?: string
): Promise<{ inputCount: number; outputCount: number; reductionPct: number }> {
  ensureDir(path.dirname(outputPath));

  const stream = fs.createReadStream(inputPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headerDone = false;
  let format = "ascii";
  let vertexCount = 0;
  let props: string[] = [];
  let verticesRead = 0;
  const voxels = new Map<string, VoxelAcc>();

  const headerLines: string[] = [];

  for await (const line of rl) {
    if (!headerDone) {
      headerLines.push(line);
      const t = line.trim();
      if (t.startsWith("format ")) format = t.split(/\s+/)[1] ?? "ascii";
      if (t.startsWith("element vertex ")) vertexCount = parseInt(t.split(/\s+/)[2] ?? "0", 10);
      if (t.startsWith("property ")) props.push(t.split(/\s+/).slice(2).join(" ") || t);
      if (t === "end_header") {
        headerDone = true;
        if (format !== "ascii") {
          throw new Error(`Only ASCII PLY supported (got ${format}): ${inputPath}`);
        }
      }
      continue;
    }

    if (verticesRead >= vertexCount) break;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    const z = parseFloat(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

    const ix = Math.floor(x / voxelSize);
    const iy = Math.floor(y / voxelSize);
    const iz = Math.floor(z / voxelSize);
    const key = `${ix},${iy},${iz}`;
    let acc = voxels.get(key);
    if (!acc) {
      acc = { x: 0, y: 0, z: 0, n: 0 };
      voxels.set(key, acc);
    }
    acc.x += x;
    acc.y += y;
    acc.z += z;
    acc.n += 1;
    // Optional RGB if present as bytes after xyz
    if (parts.length >= 6) {
      const r = parseFloat(parts[3]);
      const g = parseFloat(parts[4]);
      const b = parseFloat(parts[5]);
      if (Number.isFinite(r)) {
        acc.r = (acc.r ?? 0) + r;
        acc.g = (acc.g ?? 0) + g;
        acc.b = (acc.b ?? 0) + b;
      }
    }
    verticesRead++;
  }

  const hasColor = [...voxels.values()].some((v) => v.r != null);
  const outCount = voxels.size;
  const lines: string[] = [
    "ply",
    "format ascii 1.0",
    `comment voxel-downsampled voxelSize=${voxelSize} from ${sourceDesc ?? path.basename(inputPath)}`,
    `element vertex ${outCount}`,
    "property float x",
    "property float y",
    "property float z",
  ];
  if (hasColor) {
    lines.push("property uchar red", "property uchar green", "property uchar blue");
  }
  lines.push("end_header");

  const out = fs.createWriteStream(outputPath, { encoding: "utf8" });
  out.write(lines.join("\n") + "\n");
  for (const v of voxels.values()) {
    const x = v.x / v.n;
    const y = v.y / v.n;
    const z = v.z / v.n;
    if (hasColor && v.r != null) {
      const r = Math.max(0, Math.min(255, Math.round(v.r / v.n)));
      const g = Math.max(0, Math.min(255, Math.round((v.g ?? 0) / v.n)));
      const b = Math.max(0, Math.min(255, Math.round((v.b ?? 0) / v.n)));
      out.write(`${x} ${y} ${z} ${r} ${g} ${b}\n`);
    } else {
      out.write(`${x} ${y} ${z}\n`);
    }
  }
  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve());
    out.on("error", reject);
  });

  const reductionPct = vertexCount > 0 ? (1 - outCount / vertexCount) * 100 : 0;
  console.log(
    `Downsampled ${path.basename(inputPath)}: ${vertexCount} → ${outCount} (−${reductionPct.toFixed(1)}%)`
  );
  return { inputCount: vertexCount, outputCount: outCount, reductionPct };
}

/**
 * Choose voxel size by probing: start coarse, refine until ~90–95% reduction.
 * For speed we estimate from bounding extent of first N points.
 */
export interface VoxelInfo {
  vertexCount: number;
  min: [number, number, number];
  max: [number, number, number];
  dims: [number, number, number];
  isMeters: boolean;
  voxelSize: number;
}

/**
 * Choose voxel size by probing: detects meter vs millimeter scale and computes
 * surface-density-aware voxel grid resolution targeting ~90–95% reduction.
 */
export async function inspectAndChooseVoxelSize(
  inputPath: string,
  targetReduction = 0.92
): Promise<VoxelInfo> {
  const stream = fs.createReadStream(inputPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let headerDone = false;
  let vertexCount = 0;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let sampled = 0;
  const SAMPLE = 50000;

  for await (const line of rl) {
    if (!headerDone) {
      const t = line.trim();
      if (t.startsWith("element vertex ")) vertexCount = parseInt(t.split(/\s+/)[2] ?? "0", 10);
      if (t === "end_header") headerDone = true;
      continue;
    }
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    const z = parseFloat(parts[2]);
    if (!Number.isFinite(x)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
    sampled++;
    if (sampled >= SAMPLE) break;
  }
  rl.close();
  stream.destroy();

  const dx = Math.max(1, maxX - minX);
  const dy = Math.max(1, maxY - minY);
  const dz = Math.max(1, maxZ - minZ);
  const maxDim = Math.max(dx, dy, dz);
  const isMeters = maxDim < 500;

  // Surface-area-based heuristic: points lie on 2D building surfaces
  const area = 2 * (dx * dy + dy * dz + dx * dz);
  const targetVoxels = Math.max(1000, Math.floor(vertexCount * (1 - targetReduction)));
  let voxelSize = Math.sqrt(area / targetVoxels);

  if (isMeters) {
    // Meter scale (e.g. Week 26): clamp to 0.10m - 0.50m range (~250-350mm equivalent)
    voxelSize = Math.max(0.1, Math.min(voxelSize, 0.5));
    voxelSize = Math.round(voxelSize * 100) / 100;
  } else {
    // Millimeter scale (e.g. Weeks 27-30): clamp to 100mm - 500mm
    voxelSize = Math.max(100, Math.min(voxelSize, 500));
    voxelSize = Math.round(voxelSize);
  }

  return {
    vertexCount,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    dims: [dx, dy, dz],
    isMeters,
    voxelSize,
  };
}

export async function chooseVoxelSize(inputPath: string, targetReduction = 0.92): Promise<number> {
  const info = await inspectAndChooseVoxelSize(inputPath, targetReduction);
  return info.voxelSize;
}

export async function downsampleAllPointClouds(): Promise<Record<number, string>> {
  const outDir = path.join(DATA, "pointclouds");
  ensureDir(outDir);
  const refs: Record<number, string> = {};

  for (const week of [26, 27, 28, 29, 30]) {
    const plyDir = path.join(POINT_CLOUDS_DIR, `Week ${week}`, "PLY");
    if (!fs.existsSync(plyDir)) {
      console.warn(`Missing PLY dir for week ${week}: ${plyDir}`);
      continue;
    }
    const files = fs.readdirSync(plyDir).filter((f) => f.toLowerCase().endsWith(".ply"));
    for (const file of files) {
      const input = path.join(plyDir, file);
      const safeName = file.replace(/\s+/g, "_");
      // Correct the upstream anomaly where Week 26 folder contained "De Schepen week 27_t.ply"
      const correctedName = safeName.replace(/week_\d+/i, `week_${week}`);
      const outName = `${week}_${correctedName}`;
      const output = path.join(outDir, outName);

      console.log(`\n--- Downsampling Point Cloud: Week ${week} (${file}) ---`);
      const info = await inspectAndChooseVoxelSize(input, 0.92);
      console.log(`  Original point count: ${info.vertexCount}`);
      console.log(
        `  Computed bounding box min: [${info.min.map((v) => v.toFixed(2)).join(", ")}]`
      );
      console.log(
        `  Computed bounding box max: [${info.max.map((v) => v.toFixed(2)).join(", ")}]`
      );
      console.log(
        `  Computed dimensions: [${info.dims.map((v) => v.toFixed(2)).join(", ")}] (${info.isMeters ? "meters" : "millimeters"})`
      );
      console.log(`  Voxel size chosen: ${info.voxelSize} (${info.isMeters ? "meters" : "mm"})`);

      const relInput = path.relative(POINT_CLOUDS_DIR, input).replace(/\\/g, "/");
      const result = await downsamplePlyFile(
        input,
        output,
        info.voxelSize,
        `Week ${week} raw scan (${relInput})`
      );
      console.log(`  Resulting point count: ${result.outputCount}`);
      console.log(`  Reduction: ${result.reductionPct.toFixed(1)}%`);

      // Relative ref from shared/data/
      refs[week] = `pointclouds/${outName}`;
    }
  }

  return refs;
}

if (require.main === module) {
  downsampleAllPointClouds().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
