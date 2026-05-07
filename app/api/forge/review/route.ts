// Forge operator-review API: takes XML, returns codec output + per-stick
// confidence scores derived from the 66,262-record truth corpus stats.
//
// Confidence levels:
//   high   — op count within 1σ of corpus mean AND no ops missing that >70% of similar sticks have
//   medium — op count 1-2σ from mean OR missing one common op type
//   low    — op count >2σ from mean OR missing 2+ common op types
//
// The UI at /forge/review renders frames + sticks colour-coded by this score
// so the operator can spot likely codec misses before sending the RFY to the
// rollformer.
import { NextResponse } from "next/server";
import { decode } from "@hytek/rfy-codec";
import { readBodyText } from "@/lib/read-body";
import { framecadImportToRfy } from "@/lib/framecad-import";
import corpusStats from "@/lib/corpus-stats.json";

export const runtime = "nodejs";

interface BucketStats {
  count: number;
  op_count: { mean: number; stdev: number; p25: number; p50: number; p75: number; max: number };
  op_type_freq: Record<string, number>;
}

const STATS = corpusStats as Record<string, BucketStats>;

function lengthBucket(mm: number, size = 50): number {
  return Math.round(mm / size) * size;
}

function profileFromStick(stick: any): string {
  // RfyStick.profile is an object {metricLabel, gauge, web, lFlange, rFlange, lip,...}.
  // Build the canonical profile code "70S41_0.75" used by the corpus stats:
  //   metricLabel without spaces + "_" + gauge.
  const p = stick?.profile;
  if (!p) return "";
  if (typeof p === "string") return p;
  const lbl = String(p.metricLabel ?? "").replace(/\s+/g, "");
  const g = String(p.gauge ?? "");
  return lbl && g ? `${lbl}_${g}` : "";
}

function rolePrefix(stickName: string): string {
  return stickName.replace(/[0-9_].*$/, "");
}

function planTypeFromName(planName: string): string {
  const m = planName.match(/-([A-Z0-9]+)-\d/);
  return m ? m[1]! : "?";
}

function bucketKey(profile: string, role: string, planType: string, length: number): string {
  return `${profile}|${role}|${planType}|L${lengthBucket(length)}`;
}

function scoreStick(stick: any, planType: string): {
  confidence: "high" | "medium" | "low" | "unknown";
  reasons: string[];
  bucket: string;
  bucket_count: number;
} {
  const role = rolePrefix(stick.name);
  const profile = profileFromStick(stick);
  const len = stick.length ?? 0;
  const key = bucketKey(profile, role, planType, len);
  const stats = STATS[key];
  if (!stats || stats.count < 5) {
    return { confidence: "unknown", reasons: [`no corpus baseline (${key})`], bucket: key, bucket_count: stats?.count ?? 0 };
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
  const seenTypes = new Set(ops.map((o: any) => o.type));
  const missingCommon: string[] = [];
  for (const [t, freq] of Object.entries(stats.op_type_freq)) {
    if (freq > 0.7 && !seenTypes.has(t)) {
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

export async function POST(req: Request) {
  try {
    const xmlText = (await readBodyText(req)).trim();
    if (!xmlText) return new NextResponse("Empty body", { status: 400 });
    if (!xmlText.toLowerCase().includes("<framecad_import")) {
      return new NextResponse("Forge review accepts <framecad_import> XML only", { status: 400 });
    }

    // Run codec to produce RFY
    const result = framecadImportToRfy(xmlText);
    if (result.stickCount === 0) {
      return new NextResponse("No sticks in XML", { status: 400 });
    }
    const rfyBuf: Buffer = result.rfy;

    // Decode RFY to get structured ops
    const decoded = decode(rfyBuf);

    // Score each stick
    const scoredFrames: any[] = [];
    const counts = { high: 0, medium: 0, low: 0, unknown: 0 };
    for (const plan of decoded.project.plans) {
      const planType = planTypeFromName(plan.name);
      for (const frame of plan.frames) {
        const sticks = frame.sticks.map((s) => {
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
        scoredFrames.push({
          plan_name: plan.name,
          name: frame.name,
          sticks,
        });
      }
    }

    return NextResponse.json({
      jobnum: decoded.project.jobNum ?? "?",
      project_name: decoded.project.name,
      counts,
      total_sticks: counts.high + counts.medium + counts.low + counts.unknown,
      frames: scoredFrames,
      rfy_base64: Buffer.from(rfyBuf).toString("base64"),
      rfy_size: rfyBuf.length,
    });
  } catch (e) {
    return new NextResponse(
      `Review error: ${e instanceof Error ? e.message : String(e)}`,
      { status: 500 }
    );
  }
}
