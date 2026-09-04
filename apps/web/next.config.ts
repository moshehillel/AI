import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "../..");

loadEnv({ path: path.join(repoRoot, ".env") });

const nextConfig: NextConfig = {
  transpilePackages: [
    "@automation-studio/auth",
    "@automation-studio/db",
    "@automation-studio/domain",
    "@automation-studio/github",
    "@automation-studio/jobs",
  ],
  // Native PDF canvas + Cursor SDK must not be webpack-bundled.
  serverExternalPackages: [
    "@napi-rs/canvas",
    "unpdf",
    "@automation-studio/cursor-adapter",
    "@cursor/sdk",
  ],
  turbopack: {
    root: repoRoot,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
