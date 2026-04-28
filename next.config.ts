import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required so the @hytek/rfy-codec package (uses node:crypto + node:zlib)
  // is treated as an external on the server bundle.
  serverExternalPackages: ["@hytek/rfy-codec"],
};

export default nextConfig;
