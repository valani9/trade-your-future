import { handle, json } from "@/lib/api/helpers";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { solana } from "@/lib/solana";
import { baseUnitsToCents } from "@/lib/money";
import { getUserById } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(request, async ({ userId, db }) => {
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = await getUserById(userId);
    if (!rows[0] || !user) return json({ error: "Not found" }, 404);
    let balanceCents = 0;
    try {
      balanceCents = baseUnitsToCents(await solana().balance(rows[0].walletPubkey));
    } catch {
      balanceCents = 0;
    }
    return json({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      isDemo: user.isDemo,
      googleConnected: Boolean(rows[0].googleRefreshToken),
      balanceCents,
    });
  });
}
