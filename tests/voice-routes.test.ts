import { beforeEach, describe, expect, it, vi } from "vitest";

let currentUser: { id: string; email: string } | null = null;

vi.mock("@/lib/auth", () => ({
  requireUser: async () => currentUser,
}));

const { POST: speak } = await import("@/app/api/voice/speak/route");
const { POST: transcribe } = await import("@/app/api/voice/transcribe/route");

function post(path: string, body: BodyInit, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, { method: "POST", body, headers });
}

describe("voice routes", () => {
  beforeEach(() => {
    currentUser = null;
    delete process.env.ELEVENLABS_API_KEY;
  });

  it("refuses an anonymous caller before it can spend anything", async () => {
    const spoken = await speak(post("/api/voice/speak", JSON.stringify({ text: "Claim it" }), { "content-type": "application/json" }));
    expect(spoken.status).toBe(401);
    const heard = await transcribe(post("/api/voice/transcribe", new FormData()));
    expect(heard.status).toBe(401);
  });

  it("says voice is off for a signed-in caller when no key is configured", async () => {
    currentUser = { id: "user_1", email: "tester@example.com" };
    const spoken = await speak(post("/api/voice/speak", JSON.stringify({ text: "Claim it" }), { "content-type": "application/json" }));
    expect(spoken.status).toBe(501);
    expect((await spoken.json()).code).toBe("voice_off");
  });

  it("refuses a body bigger than the route will buffer", async () => {
    currentUser = { id: "user_1", email: "tester@example.com" };
    const big = JSON.stringify({ text: "x".repeat(12_000) });
    const res = await speak(
      new Request("http://localhost/api/voice/speak", {
        method: "POST",
        body: big,
        headers: { "content-type": "application/json", "content-length": String(big.length) },
      }),
    );
    expect(res.status).toBe(413);
  });
});
