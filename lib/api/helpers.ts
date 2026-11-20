import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "@/lib/config";
import { requireUser } from "@/lib/auth";
import { appDb } from "@/lib/boot";
import type { Db } from "@/lib/db";
import { idempotencyKeys } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { id } from "@/lib/utils";
import { rateLimit } from "./ratelimit";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(status: number, message: string, code = "error") {
  return NextResponse.json({ error: message, code }, { status });
}

export type AuthedCtx = { userId: string; db: Db; request: Request };

export async function handle(
  request: Request,
  fn: (ctx: AuthedCtx) => Promise<Response>,
): Promise<Response> {
  try {
    const user = await requireUser();
    if (!user) return fail(401, "Sign in to continue", "unauthorized");
    if (request.method !== "GET") {
      const check = rateLimit(`${user.id}:${new URL(request.url).pathname.split("/").slice(0, 4).join("/")}`);
      if (!check.ok) {
        return NextResponse.json(
          { error: "Slow down a moment", code: "rate_limited" },
          { status: 429, headers: { "retry-after": String(check.retryAfter) } },
        );
      }
    }
    const db = await appDb();
    return await fn({ userId: user.id, db, request });
  } catch (error) {
    if (error instanceof HttpError) return fail(error.status, error.message, error.code);
    if (error instanceof ZodError) {
      return fail(400, error.issues[0]?.message ?? "Invalid input", "invalid_input");
    }
    console.error("[api]", error);
    return fail(500, "Something went wrong", "internal");
  }
}

export async function handlePublic(
  request: Request,
  fn: (db: Db, request: Request) => Promise<Response>,
): Promise<Response> {
  try {
    const db = await appDb();
    return await fn(db, request);
  } catch (error) {
    if (error instanceof HttpError) return fail(error.status, error.message, error.code);
    if (error instanceof ZodError) return fail(400, error.issues[0]?.message ?? "Invalid input", "invalid_input");
    console.error("[api]", error);
    return fail(500, "Something went wrong", "internal");
  }
}

export async function body<T>(request: Request, parse: (value: unknown) => T): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "Expected a JSON body", "invalid_input");
  }
  return parse(raw);
}

export async function withIdempotency(
  ctx: AuthedCtx,
  scope: string,
  fn: () => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  const key = ctx.request.headers.get("idempotency-key");
  if (!key) throw new HttpError(400, "Idempotency-Key header is required", "missing_idempotency_key");
  if (key.length < 8 || key.length > 128) throw new HttpError(400, "Invalid Idempotency-Key", "invalid_input");
  const fingerprint = await requestFingerprint(ctx.request);
  const existing = await ctx.db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, ctx.userId), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
    .limit(1);
  if (existing[0]) {
    const stored = existing[0].body as { __fingerprint?: string; response?: unknown };
    if (stored.__fingerprint && stored.__fingerprint !== fingerprint) {
      throw new HttpError(422, "That key was already used for a different request", "idempotency_mismatch");
    }
    return json(stored.response ?? existing[0].body, existing[0].statusCode);
  }
  const result = await fn();
  if (result.status < 500) {
    await ctx.db
      .insert(idempotencyKeys)
      .values({
        id: id(),
        userId: ctx.userId,
        scope,
        key,
        statusCode: result.status,
        body: { __fingerprint: fingerprint, response: result.body } as object,
      })
      .onConflictDoNothing();
  }
  return respond(result);
}

function respond(result: { status: number; body: unknown }) {
  return json(result.body, result.status);
}

async function requestFingerprint(request: Request): Promise<string> {
  const url = new URL(request.url);
  const raw = await request.clone().text();
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(`${request.method}:${url.pathname}:${raw}`).digest("hex").slice(0, 32);
}
