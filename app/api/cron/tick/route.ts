import { NextResponse } from "next/server";
import { appDb } from "@/lib/boot";
import { cronTick } from "@/lib/services/orders";
import { expireStaleListings } from "@/lib/services/plans";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!config.demoMode() && !secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = await appDb();
  const expired = await expireStaleListings(db);
  const result = await cronTick(db);
  return NextResponse.json({ ok: true, expired, ...result });
}
