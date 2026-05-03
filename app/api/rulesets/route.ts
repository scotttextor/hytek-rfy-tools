// GET  /api/rulesets         — list all rulesets (with active flag)
// POST /api/rulesets         — create new ruleset (clone from parent)
//   body: { name, description, parent? }

import { NextResponse } from "next/server";
import { listRulesets, createRuleset } from "@/lib/rulesets";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rulesets = await listRulesets();
    return NextResponse.json({ rulesets });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Body must be JSON object" }, { status: 400 });
    }
    const { name, description, parent } = body as { name?: string; description?: string; parent?: string };
    if (!name || !description) {
      return NextResponse.json(
        { error: "name and description are required" },
        { status: 400 },
      );
    }
    const meta = await createRuleset({ name, description, parent });
    return NextResponse.json({ ok: true, meta });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
