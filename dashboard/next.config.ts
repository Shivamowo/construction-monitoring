import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Allow importing/reading assets from the monorepo `shared/` folder.
  outputFileTracingRoot: path.join(__dirname, ".."),
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
