import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { easternDate, type Reply } from "./contract.ts";
import { fixtureSource } from "./fixtures.ts";
import { createAssistantHandler, type LogEvent } from "./handler.ts";
import type { GameLogSource } from "./source.ts";
import { createVerifiedSupabaseSource } from "./supabaseSource.ts";

const points = "Average points for Avery Stone in the last 5 games";
const choose = "Average assists for Jordan Reed in the last 5 games";
const origin = "http://localhost:8080";
const user = "fixture-user";
const secret = "offline-signing-material";
const requestBody = (question: string, context?: string, requestId: string = crypto.randomUUID()) => ({
  kind: "ask", question, requestId, context,
});
function post(body: unknown, actor = user, signal?: AbortSignal) {
  return new Request("https://edge.invalid/functions/v1/ai-analytics-assistant", {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${actor}`, "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}
type HandlerOptions = Parameters<typeof createAssistantHandler>[0];
function harness(overrides: Partial<HandlerOptions> = {}) {
  return createAssistantHandler({
    authenticate(req) {
      const actor = req.headers.get("authorization")?.slice(7);
      return Promise.resolve(actor === "invalid" ? { ok: false, status: 401 }
        : actor === "service" ? { ok: true, status: 200, isServiceRole: true }
        : { ok: true, status: 200, userId: actor });
    },
    source: fixtureSource,
    now: () => new Date("2026-11-10T15:00:00Z"),
    secret: () => secret,
    origins: [origin],
    ...overrides,
  });
}
async function ask(handler: (req: Request) => Promise<Response>, question: string, context?: string, actor?: string) {
  return await (await handler(post(requestBody(question, context), actor))).json() as Reply;
}

Deno.test("follow-ups preserve the verified player, operation, window and date", async () => {
  const handler = harness();
  const first = await ask(handler, "Avery Stone over 20 points last 5 games as of 2026-11-07");
  assert(first.status === "answer" && first.context);
  const next = await ask(handler, "What about rebounds?", first.context);
  assert(next.status === "answer");
  assertEquals(next.query, { ...first.query, metric: "REB" });
  assertEquals(next.calculation, { kind: "count", comparator: "gt", threshold: 20,
    hits: 0, denominator: 5, ties: 0, pushes: 0 });
  const expanded = await ask(handler, "What about last 10 games?", next.context);
  assert(expanded.status === "error");
  assertEquals(expanded.code, "INSUFFICIENT_COVERAGE");
  assertEquals(expanded.query?.window, 10);
});

Deno.test("clarification requires a signed offered choice for the same account", async () => {
  const handler = harness();
  const first = await ask(handler, choose);
  assert(first.status === "clarification" && first.context);
  const selected = (playerId: number, actor = user) => handler(post({
    kind: "select", playerId, requestId: crypto.randomUUID(), context: first.context,
  }, actor));
  assertEquals((await (await selected(1001)).json()).code, "INVALID_SELECTION");
  assertEquals((await (await selected(1002, "another-user")).json()).code, "INVALID_CONTEXT");
  const accepted = await (await selected(1003)).json() as Reply;
  assert(accepted.status === "answer");
  assertEquals(accepted.player.team, "NYK");
  assertEquals(accepted.calculation, { kind: "average", sum: 20, denominator: 5, value: 4 });
});

Deno.test("tampered, expired and cross-account follow-up state cannot be reused", async () => {
  let date = new Date("2026-11-10T15:00:00Z");
  const handler = harness({ now: () => date });
  const first = await ask(handler, points);
  assert(first.status === "answer" && first.context);
  const changed = (first.context[0] === "A" ? "B" : "A") + first.context.slice(1);
  for (const [context, actor] of [[changed, user], [first.context, "different-user"]]) {
    const next = await ask(handler, "What about rebounds?", context, actor);
    assert(next.status === "error");
    assertEquals(next.code, "INVALID_CONTEXT");
  }
  date = new Date("2026-11-10T15:10:00Z");
  const expired = await ask(handler, "What about rebounds?", first.context);
  assert(expired.status === "error");
  assertEquals(expired.code, "INVALID_CONTEXT");
});

Deno.test("Eastern midnight and both DST boundaries use the calendar day", () => {
  assertEquals(easternDate(new Date("2026-03-08T04:59:59Z")), "2026-03-07");
  assertEquals(easternDate(new Date("2026-03-08T05:00:00Z")), "2026-03-08");
  assertEquals(easternDate(new Date("2026-03-09T04:00:00Z"), true), "2026-03-08");
  assertEquals(easternDate(new Date("2026-11-01T05:59:00Z")), "2026-11-01");
  assertEquals(easternDate(new Date("2026-11-01T06:00:00Z")), "2026-11-01");
  assertEquals(easternDate(new Date("2026-11-02T04:59:59Z"), true), "2026-10-31");
});

Deno.test("auth and origin gates reject missing, invalid and service-only identity before source access", async () => {
  let reads = 0;
  const handler = harness({
    source: { ...fixtureSource, readGames(...args) { reads++; return fixtureSource.readGames(...args); } },
  });
  for (const actor of ["invalid", "service"]) {
    const denied = await handler(post(requestBody(points), actor));
    assertEquals(denied.status, 401);
  }
  assertEquals((await handler(new Request("https://edge.invalid", { method: "POST" }))).status, 401);
  assertEquals((await handler(new Request("https://edge.invalid", {
    method: "OPTIONS", headers: { Origin: "https://unexpected.invalid" },
  }))).status, 403);
  const preflight = await handler(new Request("https://edge.invalid", { method: "OPTIONS", headers: { Origin: origin } }));
  assertEquals(preflight.status, 204);
  assertEquals(preflight.headers.get("access-control-allow-origin"), origin);
  assertEquals(reads, 0);
});

Deno.test("method, body limits and strict input shape fail before source work", async () => {
  const handler = harness();
  const invalid = await handler(post({ ...requestBody(points), url: "https://unexpected.invalid" }));
  assertEquals(invalid.status, 400);
  const huge = await handler(post(requestBody(" ".repeat(5000))));
  assertEquals(huge.status, 413);
  const tooLong = await handler(post(requestBody("a".repeat(241))));
  assertEquals(tooLong.status, 400);
  assertEquals((await handler(new Request("https://edge.invalid"))).status, 405);
});

Deno.test("missing provenance, incomplete source reads and unknown eligibility suppress calculations", async () => {
  const cases: Array<[GameLogSource, string]> = [
    [{ ...fixtureSource, snapshot: null }, "DATASET_UNAVAILABLE"],
    [{ ...fixtureSource, snapshot: { ...fixtureSource.snapshot!, source: "" } }, "DATASET_UNAVAILABLE"],
    [{ ...fixtureSource, readGames: () => Promise.resolve({ complete: false, rows: [] }) }, "DATA_UNVERIFIED"],
    [{ ...fixtureSource, async readGames(query, signal) {
      const data = await fixtureSource.readGames(query, signal);
      return { ...data, rows: data.rows.map((row) => ({ ...row, eligibility: "unknown" as const })) };
    } }, "DATA_UNVERIFIED"],
  ];
  for (const [source, code] of cases) {
    const reply = await ask(harness({ source }), points);
    assert(reply.status === "error");
    assertEquals(reply.code, code);
    assert(!("calculation" in reply));
  }
});

Deno.test("calculation also rejects conflicting duplicates and ignores cross-league rows returned by an adapter", async () => {
  for (const sport of ["NBA", "WNBA"]) {
    const source: GameLogSource = { ...fixtureSource, async readGames(query, signal) {
      const data = await fixtureSource.readGames(query, signal);
      return { ...data, rows: [...data.rows, { ...data.rows[0], sport, pts: 99 }] };
    } };
    const reply = await ask(harness({ source }), points);
    if (sport === "NBA") {
      assert(reply.status === "error");
      assertEquals(reply.code, "DATA_UNVERIFIED");
    } else {
      assert(reply.status === "answer");
      assertEquals(reply.calculation, { kind: "average", sum: 95, denominator: 5, value: 19 });
    }
  }
});

Deno.test("source exceptions and upstream 402 and 429 are reported without raw data in responses or logs", async () => {
  const privateText = "fixture-private-error-detail";
  const logs: LogEvent[] = [];
  for (const status of [402, 429, 503]) {
    const handler = harness({ log: (event) => logs.push(event), source: {
      ...fixtureSource,
      readGames: () => Promise.reject(new Error(`${status} ${privateText}`)),
    } });
    const reply = await ask(handler, points);
    assert(reply.status === "error");
    assertEquals(reply.code, "SOURCE_UNAVAILABLE");
    assert(!JSON.stringify(reply).includes(privateText));
    assertEquals(logs.at(-1)?.correlationId, reply.correlationId);
  }
  const serialized = JSON.stringify(logs);
  for (const prohibited of [points, privateText, user, secret]) assert(!serialized.includes(prohibited));
  assertEquals(logs.map((event) => event.outcome), ["SOURCE_UNAVAILABLE", "SOURCE_UNAVAILABLE", "SOURCE_UNAVAILABLE"]);
});

Deno.test("simultaneous retries share work and a request ID cannot change inputs", async () => {
  let calls = 0;
  const handler = harness({
    limits: { perUser: 1 },
    source: { ...fixtureSource, readGames(...args) { calls++; return fixtureSource.readGames(...args); } },
  });
  const body = requestBody(points);
  const [a, b] = await Promise.all([handler(post(body)), handler(post(body))]);
  const replies = [await a.json(), await b.json()];
  assertEquals(replies[0], replies[1]);
  assertEquals(calls, 1);
  const changed = await handler(post({ ...body, question: "What about rebounds?" }));
  assertEquals(changed.status, 409);
  const limited = await handler(post(requestBody(points)));
  assertEquals(limited.status, 429);
  assertEquals(limited.headers.get("retry-after"), "60");
  assertEquals(calls, 1);
});

Deno.test("concurrent distinct work reserves capacity atomically and client cancellation permits retry", async () => {
  let started!: () => void;
  let finish!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const release = new Promise<void>((resolve) => { finish = resolve; });
  let calls = 0;
  const handler = harness({
    limits: { concurrent: 1 },
    source: { ...fixtureSource, async readGames(...args) {
      calls++;
      started();
      await release;
      return await fixtureSource.readGames(...args);
    } },
  });
  const body = requestBody(points);
  const controller = new AbortController();
  const first = handler(post(body, user, controller.signal));
  await entered;
  assertEquals((await handler(post(requestBody(points)))).status, 429);
  controller.abort();
  assertEquals((await first).status, 504);
  const retry = handler(post(body));
  finish();
  assertEquals((await retry).status, 200);
  assertEquals(calls, 1);
});

Deno.test("slow source work times out without returning a number", async () => {
  const handler = harness({ timeoutMs: 100, source: { ...fixtureSource, readGames(_query, signal) {
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } } });
  const response = await handler(post(requestBody(points)));
  assertEquals(response.status, 504);
  const payload = await response.json();
  assertEquals(payload.code, "TIMEOUT");
  assert(!("calculation" in payload));
});

Deno.test("dormant Supabase adapter pages verified rows with user-scoped read-only headers", async () => {
  const oldFetch = globalThis.fetch;
  const requests: Request[] = [];
  const session = "fixture." + btoa(JSON.stringify({ sub: user, role: "authenticated" })).replace(/=+$/, "") + ".signature";
  const base = { sport: "NBA", player_id: 1001, game_date: "2026-11-09",
    pts: 10, reb: 5, ast: 4, fg3m: 2, updated_at: "2026-11-10T12:00:00Z" };
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const offset = new URL(request.url).searchParams.get("offset");
    return Promise.resolve(Response.json([{ ...base, game_id: offset === "0" ? "game-b" : "game-a" }], {
      headers: { "Content-Range": offset === "0" ? "0-0/2" : "1-1/2" },
    }));
  };
  try {
    const source = createVerifiedSupabaseSource({
      verifiedRequest: post(requestBody(points), session),
      url: "https://fixture.invalid", publishableKey: "sb_publishable_offline_fixture",
      snapshot: { ...fixtureSource.snapshot!, mode: "verified", fetchedAt: "2026-11-10T12:00:00Z" },
      players: fixtureSource.players, eligibility: new Map([["1001:game-b", "final"]]),
    });
    const read = await source.readGames({ sport: "NBA", playerId: 1001, asOf: "2026-11-10",
      metric: "PTS", window: 5, operation: { kind: "average" } }, new AbortController().signal);
    assertEquals(read.complete, true);
    assertEquals(read.rows.map((row) => row.eligibility), ["final", "unknown"]);
    assertEquals(requests.length, 2);
    for (const request of requests) {
      const url = new URL(request.url);
      assertEquals(request.method, "GET");
      assertEquals(request.headers.get("authorization"), `Bearer ${session}`);
      assertEquals(request.headers.get("apikey"), "sb_publishable_offline_fixture");
      assertEquals(url.pathname, "/rest/v1/player_recent_games");
      assertEquals(url.searchParams.get("sport"), "eq.NBA");
      assertEquals(url.searchParams.get("player_id"), "eq.1001");
      assertEquals(url.searchParams.get("game_date"), "lte.2026-11-10");
      assertEquals(url.searchParams.get("order"), "game_date.desc,game_id.desc");
    }
  } finally {
    globalThis.fetch = oldFetch;
  }
});
