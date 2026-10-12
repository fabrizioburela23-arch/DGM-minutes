import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@dgm/core", "@dgm/db"],
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
