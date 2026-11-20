import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { appDb } from "@/lib/boot";
import { resetDemo } from "@/lib/demo/seed";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!config.demoMode()) return NextResponse.json({ error: "Demo is off" }, { status: 403 });
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in to reset the demo" }, { status: 401 });
  const db = await appDb();
  const result = await resetDemo(db);
  return NextResponse.json({ ok: true, demoUserId: result.demoUserId, listings: result.listingCount });
}
