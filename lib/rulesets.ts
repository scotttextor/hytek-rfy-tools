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

/**
 * Read a JSON file, stripping a UTF-8 BOM if present.
 * The HYTEK source machine-types/frame-types files were exported by tools
 * that prepend a BOM (`0xEF 0xBB 0xBF`); JSON.parse rejects that with
 * `Unexpected token '﻿'`. Strip it before parsing.
 */
async function readJsonStripBom(file: string): Promise<unknown> {
  let raw = await fs.readFile(file, "utf8");
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

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

/** Validate ruleset name: alphanumeric + dash/underscore + space + dot, max 64 chars.
 *  Dots are allowed so `default.1`, `default.2`, etc. (versioned defaults) can be
 *  created as new dirs. Path traversal (`..`) is still rejected. */
export function isValidRulesetName(name: string): boolean {
  if (!name || typeof name !== "string") return false;
  if (name.length === 0 || name.length > 64) return false;
  if (!/^[\w\-. ]+$/.test(name)) return false;
  // Reject path traversal attempts
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return false;
  return true;
}

/**
 * A name is a "default" if it is exactly "default" OR matches the
 * versioned pattern "default.N" (default.1, default.2, ...). All
 * defaults are read-only and can never be deleted via the running app —
 * the only way to introduce or modify a default is via a code commit
 * to the repo. See docs/superpowers/specs/2026-05-03-wall-viewer-design.md
 * and the user guide section 3.1a "The default master file".
 */
export function isDefaultName(name: string): boolean {
  return name === "default" || /^default\.\d+$/.test(name);
}

/** Get the currently active ruleset name. Returns "default" if none set. */
export async function getActive(): Promise<string> {
  try {
    const parsed = (await readJsonStripBom(ACTIVE_FILE)) as { active?: string };
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
      const meta = (await readJsonStripBom(path.join(dir, "meta.json"))) as RulesetMeta;
      // Defense-in-depth: if any default* ruleset has readonly:false in
      // its meta.json (manual tampering or a bug), force-flag readonly
      // anyway. The lib NEVER trusts a default* meta.json to opt out
      // of read-only.
      const meta2 = isDefaultName(entry) ? { ...meta, readonly: true } : meta;
      out.push({ ...meta2, active: entry === active });
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
  return {
    meta: (await readJsonStripBom(path.join(dir, "meta.json"))) as RulesetMeta,
    machineTypes: await readJsonStripBom(path.join(dir, "machine-types.json")),
    frameTypes: await readJsonStripBom(path.join(dir, "frame-types.json")),
  };
}

/** Get only the machine-types data for a ruleset (for the existing /api/setups). */
export async function getRulesetMachineTypes(name: string): Promise<unknown> {
  if (!isValidRulesetName(name)) {
    throw new Error(`Invalid ruleset name: ${name}`);
  }
  return readJsonStripBom(path.join(RULESETS_DIR, name, "machine-types.json"));
}

/** Get only the frame-types data for a ruleset. */
export async function getRulesetFrameTypes(name: string): Promise<unknown> {
  if (!isValidRulesetName(name)) {
    throw new Error(`Invalid ruleset name: ${name}`);
  }
  return readJsonStripBom(path.join(RULESETS_DIR, name, "frame-types.json"));
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
  if (isDefaultName(name)) {
    throw new Error(
      `Cannot create ruleset with reserved name "${name}". The default* namespace ` +
      `(default, default.1, default.2 ...) is reserved for factory baselines that ` +
      `can only be added by a code commit to the repo. Use a different name.`
    );
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
  // STANDING DIRECTIVE: any default* ruleset is read-only at the lib
  // layer regardless of its meta.json. This blocks any caller — UI,
  // direct API hit, or admin script — from overwriting a factory
  // baseline. The only path to change `default*` is a code commit to
  // data/rulesets/.
  if (isDefaultName(name)) {
    throw new Error(
      `Ruleset "${name}" is a protected factory default and can never be edited via ` +
      `the app. To create a new factory baseline (default.N), edit data/rulesets/ in ` +
      `the repo and push. Use Save As to create a named editable copy instead.`
    );
  }
  let meta: RulesetMeta;
  try {
    meta = (await readJsonStripBom(metaPath)) as RulesetMeta;
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

/** Delete a named ruleset. Cannot delete any default* or the active ruleset. */
export async function deleteRuleset(name: string): Promise<void> {
  if (!isValidRulesetName(name)) {
    throw new Error(`Invalid ruleset name: ${name}`);
  }
  // STANDING DIRECTIVE: every factory baseline (default, default.1, ...)
  // stays on disk forever. Removing one would erase a ruleset users
  // might want to roll back to. Defaults are only removable via a code
  // change in the repo (delete the dir, push), and that's intentional.
  if (isDefaultName(name)) {
    throw new Error(
      `Cannot delete protected factory default "${name}". The default* namespace ` +
      `is preserved permanently for full rollback. Defaults are only removable via ` +
      `a code commit to the repo.`
    );
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
