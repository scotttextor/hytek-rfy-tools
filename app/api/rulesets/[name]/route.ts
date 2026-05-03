// GET    /api/rulesets/[name]  — full data for a ruleset
// PUT    /api/rulesets/[name]  — save changes (machineTypes, frameTypes, description)
// DELETE /api/rulesets/[name]  — delete a ruleset

import { NextResponse } from "next/server";
import { getRuleset, saveRuleset, deleteRuleset } from "@/lib/rulesets";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await ctx.params;
    const data = await getRuleset(name);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("does not exist") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await ctx.params;
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Body must be JSON object" }, { status: 400 });
    }
    const { machineTypes, frameTypes, description } = body as {
      machineTypes?: unknown;
      frameTypes?: unknown;
      description?: string;
    };
    await saveRuleset({ name, machineTypes, frameTypes, description });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("read-only")
      ? 403
      : msg.includes("does not exist")
        ? 404
        : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await ctx.params;
    await deleteRuleset(name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("default") || msg.includes("active") ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
