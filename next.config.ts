import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
};

export default nextConfig;
