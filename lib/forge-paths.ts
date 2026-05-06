// Shared path resolvers for the Forge cache + queue. Mirrors the resolution
// logic in forge/cache/store.py so TS + Python agree on locations.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function resolveCacheRoot(): string {
  const env = process.env.FORGE_CACHE_DIR;
  if (env) return env;
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) {
    try {
      const entries = readdirSync(home);
      // Prefer "OneDrive - <suffix>" (work account) over plain "OneDrive"
      const oneDrives = entries
        .filter((e) => e.startsWith("OneDrive"))
        .sort((a, b) => (a === "OneDrive" ? 1 : 0) - (b === "OneDrive" ? 1 : 0));
      for (const e of oneDrives) {
        const candidate = join(home, e, "CLAUDE DATA FILE", "detailer-oracle-cache");
        if (existsSync(candidate)) return candidate;
      }
      if (oneDrives.length > 0) {
        return join(home, oneDrives[0]!, "CLAUDE DATA FILE", "detailer-oracle-cache");
      }
    } catch {
      // ignore
    }
  }
  return "C:\\Users\\Scott\\OneDrive - Textor Metal Industries\\CLAUDE DATA FILE\\detailer-oracle-cache";
}

export function queueDir(): string {
  return join(resolveCacheRoot(), "_queue");
}
