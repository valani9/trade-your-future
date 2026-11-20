import { getDb, closeDb } from "@/lib/db";
import { resetDemo } from "@/lib/demo/seed";

async function main() {
  const db = await getDb();
  const result = await resetDemo(db);
  console.log(`seeded ${result.listingCount} listings for the demo workspace`);
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
