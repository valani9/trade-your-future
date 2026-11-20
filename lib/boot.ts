import { getDb, type Db } from "@/lib/db";
import { config } from "@/lib/config";
import { ensureSeed } from "@/lib/demo/seed";

let seeded: Promise<void> | null = null;

export async function appDb(): Promise<Db> {
  const db = await getDb();
  if (config.demoMode()) {
    if (!seeded) {
      seeded = ensureSeed(db).catch(() => {
        seeded = null;
      });
    }
    await seeded;
  }
  return db;
}
