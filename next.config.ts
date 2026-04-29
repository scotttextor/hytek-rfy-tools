import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required so the @hytek/rfy-codec package (uses node:crypto + node:zlib)
  // is treated as an external on the server bundle.
  serverExternalPackages: ["@hytek/rfy-codec"],
};

export default nextConfig;
// Force rebuild 29 Apr 2026 13:34:25
