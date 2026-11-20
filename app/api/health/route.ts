import { NextResponse } from "next/server";
import { getDb, getDbInfo } from "@/lib/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    const info = await getDbInfo();
    return NextResponse.json({
      ok: true,
      db: true,
      mode: (process.env.DEMO_MODE ?? "true") !== "false" ? "demo" : "live",
      store: info.kind,
    });
  } catch {
    return NextResponse.json({ ok: false, db: false }, { status: 500 });
  }
}
