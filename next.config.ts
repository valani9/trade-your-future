import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
  async rewrites() {
    return {
      beforeFiles: [{ source: "/demo/:name.jpg", destination: "/demo/:name.webp" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
