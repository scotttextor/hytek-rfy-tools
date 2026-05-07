// Vitest config — runs the unit tests under app/viewer/lib/ in node
// environment. No DOM is needed (the lib files are pure data
// transforms), so we explicitly opt out of jsdom for fast startup.

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig path alias `@/*` → repo root so route handlers
      // can be unit-tested without an HTTP server.
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "app/viewer/lib/**/*.test.ts",
      "app/api/**/*.test.ts",
      "lib/**/*.test.ts",
      "scripts/**/*.test.ts",
      "forge/**/*.test.ts",
    ],
    // The codec is a CommonJS package shipped via GitHub install.
    // Vitest's default Vite SSR resolution handles it without extra
    // config; tested 2026-05-03 against @hytek/rfy-codec 0.1.0.
  },
});
