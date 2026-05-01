import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Root-level defaults that each package inherits. The `include` pattern is
// intentionally relative ("./src/**"), so when a package's `npm test` invokes
// vitest from its own directory it autodiscovers its own tests without
// tripping on the monorepo root path.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: false,
    testTimeout: 15_000,
  },
});
