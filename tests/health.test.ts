import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("health", () => {
  it("reports ok with a live database", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe(true);
    expect(body.mode).toBe("demo");
  });
});
