// One-shot config for verifying TB2B pre-trim guard migration.
// Delete after Agent Q migration is signed off.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/framecad-import.tb2b-guards.test.ts"],
  },
});
