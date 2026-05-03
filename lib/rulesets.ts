// Ruleset management — versioned named-template snapshots of all HYTEK rules.
//
// Each ruleset is a folder under data/rulesets/<name>/ containing:
//   meta.json          — name, description, created, readonly, parent
//   machine-types.json — full HYTEK machine setups payload
//   frame-types.json   — full HYTEK frame types payload
//
// The "default" ruleset is read-only and represents factory HYTEK rules.
// Users create named copies ("templates") to experiment, can switch between
// them at any time, and can revert to default. Changes never affect default.

import fs from "node:fs/promises";
import path from "node:path";

const RULESETS_DIR = path.join(process.cwd(), "data", "rulesets");
const ACTIVE_FILE = path.join(RULESETS_DIR, "active.json");

export interface RulesetMeta {
  name: string;
  description: string;
  created: string;        // ISO timestamp
  readonly: boolean;
  parent: string | null;  // null for default, name of parent for derived
}

export interface RulesetListEntry extends RulesetMeta {
  active: boolean;
}

/** Validate ruleset name: alphanumeric + dash/underscore + space, max 64 chars */
export function isValidRulesetName(name: string): boolean {
  if (!name || typeof name !== "string") return false;
  if (name.length === 0 || name.length > 64) return false;
  if (!/^[\w\- ]+$/.test(name)) return false;
  // Reject path traversal attempts
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return false;
  return true;
}

/** Get the currently active ruleset name. Returns "default" if none set. */
export async function getActive(): Promise<string> {
  try {
    const raw = await fs.readFile(ACTIVE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.active || "default";
  } catch {
    return "default";
  }
}

/** Set the active ruleset by name. Validates that it exists. */
export async function setActive(name: string): Promise<void> {
  if (!isValidRulesetName(name)) {
    throw new Error(`Invalid ruleset name: ${name}`);
  }
  const dir = path.join(RULESETS_DIR, name);
  try {
    await fs.access(dir);
  } catch {
    throw new Error(`Ruleset does not exist: ${name}`);
  }
  await fs.writeFile(ACTIVE_FILE, JSON.stringify({ active: name }, null, 2), "utf8");
}

/** List all available rulesets. */
export async function listRulesets(): Promise<RulesetListEntry[]> {
  const entries = await fs.readdir(RULESETS_DIR);
  const active = await getActive();
  const out: RulesetListEntry[] = [];
  for (const entry of entries) {
    if (entry === "active.json") continue;
    const dir = path.join(RULESETS_DIR, entry);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    try {
      const metaRaw = await fs.readFile(path.join(dir, "meta.json"), "utf8");
      const meta = JSON.parse(metaRaw) as RulesetMeta;
      out.push({ ...meta, active: entry === active });
    } catch {
      // Skip rulesets with broken meta
    }
  }
  // Sort: default first, then alphabetical
  out.sort((a, b) => {
    if (a.name === "default") return -1;
    if (b.name === "default") return 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/** Get the full data for a named ruleset. */
export async function getRuleset(name: string): Promise<{
  meta: RulesetMeta;
  machineTypes: unknown;
  frameTypes: unknown;
}> {
  if (!isValidRulesetName(name)) {
    throw new Error(`Invalid ruleset name: ${name}`);
  }
  const dir = path.join(RULESETS_DIR, name);
  const metaRaw = await fs.readFile(path.join(dir, "meta.json"), "utf8");
  const machineRaw = await fs.readFile(path.join(dir, "machine-types.json"), "utf8");
  const frameRaw = await fs.readFile(path.join(dir, "frame-types.json"), "utf8");
  return {
    meta: JSON.parse(metaRaw),
    machineTypes: JSON.parse(machineRaw),
    frameTypes: JSON.parse(frameRaw),
  };
}

/** Get only the machine-types data for a ruleset (for the existing /api/setups). */
export async function getRulesetMachineTypes(name: string): Promise<unknown> {
  if (!isValidRulesetName(name)) {
    throw new Error(`Invalid ruleset name: ${name}`);
  }
  const file = path.join(RULESETS_DIR, name, "machine-types.json");
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

/** Get only the frame-types data for a ruleset. */
export async function getRulesetFrameTypes(name: string): Promise<unknown> {
  if (!isValidRulesetName(name)) {
    throw new Error(`Invalid ruleset name: ${name}`);
  }
  const file = path.join(RULESETS_DIR, name, "frame-types.json");
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

/** Create a new named ruleset by cloning from a parent (or "default"). */
export async function createRuleset(args: {
  name: string;
  description: string;
  parent?: string;
}): Promise<RulesetMeta> {
  const { name, description } = args;
  const parent = args.parent || "default";
  if (!isValidRulesetName(name)) {
    throw new Error(`Invalid ruleset name: ${name}`);
  }
  if (name === "default") {
    throw new Error(`Cannot create ruleset named "default" — that's the protected factory ruleset`);
  }
  const dir = path.join(RULESETS_DIR, name);
  // Reject if already exists
  try {
    await fs.access(dir);
    throw new Error(`Ruleset already exists: ${name}`);
  } catch (e) {
    if (e instanceof Error && e.message.includes("already exists")) throw e;
    // Otherwise dir doesn't exist — proceed
  }
  // Clone parent
  const parentDir = path.join(RULESETS_DIR, parent);
  try {
    await fs.access(parentDir);
  } catch {
    throw new Error(`Parent ruleset does not exist: ${parent}`);
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(
    path.join(parentDir, "machine-types.json"),
    path.join(dir, "machine-types.json"),
  );
  await fs.copyFile(
    path.join(parentDir, "frame-types.json"),
    path.join(dir, "frame-types.json"),
  );
  const meta: RulesetMeta = {
    name,
    description,
    created: new Date().toISOString(),
    readonly: false,
    parent,
  };
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

/** Save changes to a ruleset. Default ruleset is read-only. */
export async function saveRuleset(args: {
  name: string;
  machineTypes?: unknown;
  frameTypes?: unknown;
  description?: string;
}): Promise<void> {
  const { name } = args;
  if (!isValidRulesetName(name)) {
    throw new Error(`Invalid ruleset name: ${name}`);
  }
  const dir = path.join(RULESETS_DIR, name);
  const metaPath = path.join(dir, "meta.json");
  let meta: RulesetMeta;
  try {
    meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
  } catch {
    throw new Error(`Ruleset does not exist: ${name}`);
  }
  if (meta.readonly) {
    throw new Error(`Ruleset is read-only: ${name} (use Save As to create a new editable copy)`);
  }
  if (args.machineTypes !== undefined) {
    await fs.writeFile(
      path.join(dir, "machine-types.json"),
      JSON.stringify(args.machineTypes, null, 2),
      "utf8",
    );
  }
  if (args.frameTypes !== undefined) {
    await fs.writeFile(
      path.join(dir, "frame-types.json"),
      JSON.stringify(args.frameTypes, null, 2),
      "utf8",
    );
  }
  if (args.description !== undefined) {
    const updated: RulesetMeta = { ...meta, description: args.description };
    await fs.writeFile(metaPath, JSON.stringify(updated, null, 2), "utf8");
  }
}

/** Delete a named ruleset. Cannot delete default or active. */
export async function deleteRuleset(name: string): Promise<void> {
  if (!isValidRulesetName(name)) {
    throw new Error(`Invalid ruleset name: ${name}`);
  }
  if (name === "default") {
    throw new Error(`Cannot delete the default ruleset`);
  }
  const active = await getActive();
  if (name === active) {
    throw new Error(`Cannot delete the active ruleset — switch to another first`);
  }
  const dir = path.join(RULESETS_DIR, name);
  try {
    await fs.access(dir);
  } catch {
    throw new Error(`Ruleset does not exist: ${name}`);
  }
  await fs.rm(dir, { recursive: true, force: true });
}
