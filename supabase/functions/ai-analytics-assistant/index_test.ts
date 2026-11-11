import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { Reply } from "../_shared/analyticsAssistant/contract.ts";

type Handler = (request: Request) => Promise<Response>;

const originalServe = Deno.serve;
let registered: Handler | undefined;
try {
  Deno.serve = ((handler: Handler) => { registered = handler; }) as unknown as typeof Deno.serve;
  await import("./index.ts");
} finally {
  Deno.serve = originalServe;
}
assert(registered);
const handle = registered;
const userId = "0ca8eb2a-4f15-4b44-bec5-cb9cb4b78773";
const token = `fixture.${btoa(JSON.stringify({ sub: userId, role: "authenticated" })).replace(/=+$/, "")}.signature`;
const publicKey = "sb_publishable_integration_fixture";
const serviceKey = "sb_secret_integration_fixture";
const env = {
  SUPABASE_URL: "https://auth-fixture.invalid",
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: publicKey }),
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: serviceKey }),
};

function request(headers: HeadersInit) {
  const jsonHeaders = new Headers(headers);
  jsonHeaders.set("content-type", "application/json");
  return new Request("https://edge.invalid/functions/v1/ai-analytics-assistant", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      kind: "ask", requestId: crypto.randomUUID(), question: "Average points for Avery Stone in the last 5 games",
    }),
  });
}

async function withAuthStub(test: (calls: Request[]) => Promise<void>) {
  const originals = new Map([...Object.keys(env), "ANALYTICS_CONTEXT_SECRET"].map((name) => [name, Deno.env.get(name)]));
  const originalFetch = globalThis.fetch;
  const calls: Request[] = [];
  try {
    Deno.env.delete("ANALYTICS_CONTEXT_SECRET");
    for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
    globalThis.fetch = (input, init) => {
      const req = new Request(input, init);
      calls.push(req);
      assertEquals(req.url, "https://auth-fixture.invalid/auth/v1/user");
      assertEquals(req.headers.get("apikey"), publicKey);
      return Promise.resolve(req.headers.get("authorization") === `Bearer ${token}`
        ? Response.json({ id: userId, role: "authenticated" })
        : Response.json({ message: "Invalid session" }, { status: 401 }));
    };
    await test(calls);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of originals) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("registered Edge Function verifies user JWT and returns a fixture without data requests", async () => {
  await withAuthStub(async (calls) => {
    const response = await handle(request({ apikey: publicKey, authorization: `Bearer ${token}` }));
    assertEquals(response.status, 200);
    const reply: Reply = await response.json();
    assert(reply.status === "answer");
    assertEquals(reply.calculation, { kind: "average", denominator: 5, sum: 95, value: 19 });
    assertEquals(reply.provenance.freshness, "frozen_fixture");
    assertEquals(calls.length, 1);
  });
});

Deno.test("registered Edge Function rejects key-only access and invalid Supabase sessions", async () => {
  await withAuthStub(async (calls) => {
    const secret = await handle(request({ apikey: serviceKey }));
    const publishable = await handle(request({ apikey: publicKey, authorization: `Bearer ${publicKey}` }));
    const invalidSession = await handle(request({ apikey: publicKey, authorization: `Bearer ${token}bad` }));
    assertEquals([secret.status, publishable.status, invalidSession.status], [401, 401, 401]);
    assertEquals(calls.length, 1);
  });
});

Deno.test("registered Edge Function fails closed with a weak explicit signing secret", async () => {
  await withAuthStub(async () => {
    Deno.env.set("ANALYTICS_CONTEXT_SECRET", "short-test-value");
    const response = await handle(request({ apikey: publicKey, authorization: `Bearer ${token}` }));
    assertEquals(response.status, 503);
    assertEquals((await response.json()).code, "AUTH_UNAVAILABLE");
  });
});
