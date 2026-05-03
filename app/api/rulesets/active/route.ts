// GET  /api/rulesets/active  — { active: <name> }
// POST /api/rulesets/active  — switch active ruleset
//   body: { name }

import { NextResponse } from "next/server";
import { getActive, setActive } from "@/lib/rulesets";

export const runtime = "nodejs";

export async function GET() {
  const active = await getActive();
  return NextResponse.json({ active });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Body must be JSON object" }, { status: 400 });
    }
    const { name } = body as { name?: string };
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    await setActive(name);
    return NextResponse.json({ ok: true, active: name });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
