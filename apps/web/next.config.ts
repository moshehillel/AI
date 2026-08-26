import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@automation-studio/auth",
    "@automation-studio/db",
    "@automation-studio/domain",
    "@automation-studio/jobs",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
