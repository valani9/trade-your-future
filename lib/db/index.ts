import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNode, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

type Store = {
  db: Db;
  client: PGlite | Pool;
  ready: Promise<void>;
  kind: "pglite" | "postgres";
};

declare global {
  var __tyfStore: Store | undefined;
}

function migrationSql(): string[] {
  const dir = path.join(process.cwd(), "db", "migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
}

async function migratePglite(client: PGlite) {
  await client.exec(`CREATE TABLE IF NOT EXISTS "__migrations" ("name" text PRIMARY KEY NOT NULL)`);
  for (const file of fs.readdirSync(path.join(process.cwd(), "db", "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    const done = await client.query<{ name: string }>(`SELECT name FROM "__migrations" WHERE name = $1`, [file]);
    if (done.rows.length) continue;
    const statements = fs
      .readFileSync(path.join(process.cwd(), "db", "migrations", file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) await client.exec(statement);
    await client.query(`INSERT INTO "__migrations" ("name") VALUES ($1)`, [file]);
  }
}

export async function getDb(): Promise<Db> {
  if (globalThis.__tyfStore) {
    await globalThis.__tyfStore.ready;
    return globalThis.__tyfStore.db;
  }
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("postgres")) {
    const client = new Pool({ connectionString: url, max: 8 });
    const db = drizzleNode(client, { schema });
    const store: Store = { db, client, kind: "postgres", ready: Promise.resolve() };
    globalThis.__tyfStore = store;
    return db;
  }
  const dir = process.env.PGLITE_DIR ?? (process.env.NODE_ENV === "test" ? "memory://" : "./.pgdata");
  const client = dir === "memory://" ? new PGlite() : new PGlite(dir);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  const store: Store = { db, client, kind: "pglite", ready: migratePglite(client) };
  globalThis.__tyfStore = store;
  await store.ready;
  return db;
}

export async function getDbInfo() {
  await getDb();
  return { kind: globalThis.__tyfStore!.kind };
}

export async function closeDb() {
  const store = globalThis.__tyfStore;
  if (!store) return;
  globalThis.__tyfStore = undefined;
  if (store.kind === "pglite") await (store.client as PGlite).close();
  else await (store.client as Pool).end();
}

export { schema, migrationSql };
