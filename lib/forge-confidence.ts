// Shared per-stick confidence scoring for the Forge operator-review pipeline.
//
// Confidence is derived from `lib/corpus-stats.json`, a 66,262-record snapshot
// of (profile, role, plan-type, length-bucket) → op-count + op-type-frequency
// distributions. For a given codec-emitted stick we ask:
//
//   1. Is the op count within ~1σ of the typical bucket?
//   2. Is the codec missing any op-types that >70% of similar sticks have?
//   3. Is the codec emitting unusual op-types (<10% of similar sticks have)?
//
// The reasoning for each bucket lives next to scoreStick(). This module is
// imported by:
//   - app/api/forge/review/route.ts  — operator review screen (always scores)
//   - app/api/encode-auto/route.ts   — opt-in via ?withConfidence=1
//
// IMPORTANT: keep this module pure (no fs/network) so it stays cheap to call
// from any path. Both routes already have the decoded RfyDocument; we only
// need the corpus stats here, which are bundled at build time.

import type { RfyDocument, RfyStick } from "@hytek/rfy-codec";
import corpusStats from "@/lib/corpus-stats.json";

export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

interface BucketStats {
  count: number;
  op_count: { mean: number; stdev: number; p25: number; p50: number; p75: number; max: number };
  op_type_freq: Record<string, number>;
}

const STATS = corpusStats as Record<string, BucketStats>;

export interface ConfidenceCounts {
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

export interface ScoredStick {
  name: string;
  length: number;
  profile: string;
  role: string;
  tooling: RfyStick["tooling"];
  confidence: ConfidenceLevel;
  reasons: string[];
  bucket: string;
  bucket_count: number;
}

export interface ScoredFrame {
  plan_name: string;
  name: string;
  sticks: ScoredStick[];
}

export interface ScoredDocument {
  counts: ConfidenceCounts;
  total_sticks: number;
  frames: ScoredFrame[];
}

export function lengthBucket(mm: number, size = 50): number {
  return Math.round(mm / size) * size;
}

export function profileFromStick(stick: RfyStick | { profile?: unknown }): string {
  // RfyStick.profile is an object {metricLabel, gauge, web, lFlange, rFlange, lip,...}.
  // Build the canonical profile code "70S41_0.75" used by the corpus stats:
  //   metricLabel without spaces + "_" + gauge.
  const p = (stick as { profile?: unknown }).profile;
  if (!p) return "";
  if (typeof p === "string") return p;
  const obj = p as { metricLabel?: unknown; gauge?: unknown };
  const lbl = String(obj.metricLabel ?? "").replace(/\s+/g, "");
  const g = String(obj.gauge ?? "");
  return lbl && g ? `${lbl}_${g}` : "";
}

export function rolePrefix(stickName: string): string {
  return stickName.replace(/[0-9_].*$/, "");
}

export function planTypeFromName(planName: string): string {
  const m = planName.match(/-([A-Z0-9]+)-\d/);
  return m ? m[1]! : "?";
}

export function bucketKey(profile: string, role: string, planType: string, length: number): string {
  return `${profile}|${role}|${planType}|L${lengthBucket(length)}`;
}

export interface ScoreStickResult {
  confidence: ConfidenceLevel;
  reasons: string[];
  bucket: string;
  bucket_count: number;
}

/**
 * Score a single decoded stick against the corpus baseline. Pure / synchronous;
 * runs in O(ops + bucket-op-types).
 *
 * Levels:
 *   high   — op count within 1σ AND no missing common op-types AND no unusual op-types
 *   medium — 1σ < op count < 2σ OR missing exactly one common op-type OR any unusual op-type
 *   low    — op count > 2σ OR missing 2+ common op-types
 *   unknown — bucket has fewer than 5 corpus samples (no reliable baseline)
 */
export function scoreStick(stick: RfyStick, planType: string): ScoreStickResult {
  const role = rolePrefix(stick.name);
  const profile = profileFromStick(stick);
  const len = stick.length ?? 0;
  const key = bucketKey(profile, role, planType, len);
  const stats = STATS[key];
  if (!stats || stats.count < 5) {
    return {
      confidence: "unknown",
      reasons: [`no corpus baseline (${key})`],
      bucket: key,
      bucket_count: stats?.count ?? 0,
    };
  }
  const reasons: string[] = [];
  const ops = stick.tooling ?? [];
  const opCount = ops.length;
  const { mean, stdev } = stats.op_count;
  const sigmaAway = stdev > 0 ? Math.abs(opCount - mean) / stdev : 0;
  if (sigmaAway > 2) {
    reasons.push(`op count ${opCount} is ${sigmaAway.toFixed(1)}σ from typical (${mean}±${stdev})`);
  } else if (sigmaAway > 1) {
    reasons.push(`op count ${opCount} is ${sigmaAway.toFixed(1)}σ from typical`);
  }
  // Check for missing common op types (>70% of similar sticks have them)
  const seenTypes = new Set(ops.map((o) => o.type));
  const missingCommon: string[] = [];
  for (const [t, freq] of Object.entries(stats.op_type_freq)) {
    if (freq > 0.7 && !seenTypes.has(t as RfyStick["tooling"][number]["type"])) {
      missingCommon.push(`${t} (in ${(freq * 100).toFixed(0)}% of similar)`);
    }
  }
  if (missingCommon.length > 0) {
    reasons.push(`missing common op-types: ${missingCommon.join(", ")}`);
  }
  // Check for unusual op types (codec emits something <10% of similar sticks have)
  const unusualTypes: string[] = [];
  for (const t of seenTypes) {
    const tt = t as string;
    const freq = stats.op_type_freq[tt] ?? 0;
    if (freq < 0.1) {
      unusualTypes.push(`${tt} (only in ${(freq * 100).toFixed(0)}% of similar)`);
    }
  }
  if (unusualTypes.length > 0) {
    reasons.push(`unusual op-types emitted: ${unusualTypes.join(", ")}`);
  }
  let confidence: "high" | "medium" | "low" = "high";
  if (sigmaAway > 2 || missingCommon.length >= 2) confidence = "low";
  else if (sigmaAway > 1 || missingCommon.length === 1 || unusualTypes.length > 0) confidence = "medium";
  return { confidence, reasons, bucket: key, bucket_count: stats.count };
}

/**
 * Score every stick across every plan/frame in a decoded RFY document.
 * Returns aggregate counts plus the per-frame breakdown the review UI needs.
 */
export function scoreDecodedDocument(decoded: RfyDocument): ScoredDocument {
  const counts: ConfidenceCounts = { high: 0, medium: 0, low: 0, unknown: 0 };
  const frames: ScoredFrame[] = [];
  for (const plan of decoded.project.plans) {
    const planType = planTypeFromName(plan.name);
    for (const frame of plan.frames) {
      const sticks = frame.sticks.map<ScoredStick>((s) => {
        const score = scoreStick(s, planType);
        counts[score.confidence]++;
        return {
          name: s.name,
          length: s.length,
          profile: profileFromStick(s),
          role: rolePrefix(s.name),
          tooling: s.tooling,
          confidence: score.confidence,
          reasons: score.reasons,
          bucket: score.bucket,
          bucket_count: score.bucket_count,
        };
      });
      frames.push({ plan_name: plan.name, name: frame.name, sticks });
    }
  }
  return {
    counts,
    total_sticks: counts.high + counts.medium + counts.low + counts.unknown,
    frames,
  };
}
