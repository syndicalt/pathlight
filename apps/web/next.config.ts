import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle so the Docker image can ship
  // ~30MB of JS instead of the full monorepo's node_modules.
  output: "standalone",
};

export default nextConfig;
