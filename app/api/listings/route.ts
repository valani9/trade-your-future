import { z } from "zod";
import { handle, json, body } from "@/lib/api/helpers";
import { createListing } from "@/lib/services/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ planId: z.string().min(1), priceCents: z.number().int() });

export async function POST(request: Request) {
  return handle(request, async ({ userId, db }) => {
    const input = await body(request, (v) => schema.parse(v));
    const listing = await createListing(db, userId, input);
    return json(listing, 201);
  });
}
