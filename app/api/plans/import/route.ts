import { z } from "zod";
import { handle, json, body } from "@/lib/api/helpers";
import { plans } from "@/lib/db/schema";
import { parseConfirmation } from "@/lib/services/import";
import { id } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ text: z.string().min(4).max(4000) });

export async function POST(request: Request) {
  return handle(request, async ({ userId, db }) => {
    const input = await body(request, (v) => schema.parse(v));
    const parsed = parseConfirmation(input.text);
    const planId = id();
    await db.insert(plans).values({
      id: planId,
      userId,
      category: parsed.category,
      title: parsed.title,
      venue: parsed.venue,
      city: parsed.city,
      timeZone: parsed.timeZone,
      startsAt: parsed.startsAt,
      endsAt: parsed.endsAt,
      source: "import",
      externalId: `import:${planId}`,
      faceValueCents: parsed.faceValueCents,
      transferability: parsed.transferability,
      status: "active",
      imageUrl: imageFor(parsed.category),
    });
    return json({ id: planId, ...parsed, startsAt: parsed.startsAt.toISOString(), endsAt: parsed.endsAt.toISOString() }, 201);
  });
}

function imageFor(category: string) {
  const map: Record<string, string> = {
    concert: "concert-hall",
    sports: "arena-game",
    restaurant: "restaurant-table",
    hotel: "hotel-room",
    class: "pottery-studio",
    experience: "rooftop-night",
    flight: "plane-window",
  };
  return `/demo/${map[category] ?? "rooftop-night"}.webp`;
}
