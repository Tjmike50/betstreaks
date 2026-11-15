import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { dailyPickCron, pipelineCron, scheduleVerification } from "./internalAuth.ts";
import { requireAdmin, requireAuth } from "./adminAuth.ts";

function session(subject: string, role = "authenticated") {
  const payload = btoa(JSON.stringify({ sub: subject, role })).replace(/=+$/, "");
  return `fixture.${payload}.signature`;
}

const publicKey = "sb_publishable_fixture";
const serviceKey = "sb_secret_fixture";
const adminSession = session("admin-user");
const memberSession = session("member-user");
const invalidSession = session("invalid-session");

const cronToken = "a".repeat(64);
const verificationToken = "b".repeat(64);
const fakeProviderKey = "fixture-provider-key";
const env = {
  SUPABASE_URL: "https://database.invalid",
  SUPABASE_ANON_KEY: "legacy-public-fixture",
  SUPABASE_SERVICE_ROLE_KEY: "legacy-service-fixture",
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: publicKey }),
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: serviceKey }),
  [dailyPickCron.env]: cronToken,
  [pipelineCron.env]: "c".repeat(64),
  [scheduleVerification.env]: verificationToken,
  SPORTSDATAIO_API_KEY: fakeProviderKey,
  REFRESH_SECRET: "r".repeat(64),
};

type EdgeHandler = (req: Request) => Promise<Response>;
type Stub = (req: Request, url: URL) => Response | undefined;

// Capture the actual entrypoint registration without starting a listener.
async function loadHandler(load: () => Promise<unknown>): Promise<EdgeHandler> {
  const originalServe = Deno.serve;
  let handler: EdgeHandler | undefined;
  Deno.serve = ((registered: EdgeHandler) => { handler = registered; }) as unknown as typeof Deno.serve;
  try {
    await load();
    assert(handler);
    return handler;
  } finally {
    Deno.serve = originalServe;
  }
}

const dailyPick = await loadHandler(() => import("../generate-daily-pick/index.ts"));
const mlbHealth = await loadHandler(() => import("../mlb-health-check/index.ts"));
const verifySchedule = await loadHandler(() => import("../verify-schedule/index.ts"));
const runPipeline = await loadHandler(() => import("../run-daily-pipeline/index.ts"));
const refreshHandlers = [
  await loadHandler(() => import("../collect-line-snapshots/index.ts")),
  await loadHandler(() => import("../refresh-availability/index.ts")),
  await loadHandler(() => import("../refresh-mlb-data/index.ts")),
  await loadHandler(() => import("../refresh-wnba-data/index.ts")),
  await loadHandler(() => import("../refresh-mlb-team-map/index.ts")),
  await loadHandler(() => import("../summarize-mlb-performance/index.ts")),
];

function request(headers: HeadersInit = {}, body = {}, query = "") {
  return new Request(`https://edge.invalid/${query}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function mock(test: (requests: Request[]) => Promise<void>, stub?: Stub) {
  return async () => {
    const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
    const originalFetch = globalThis.fetch;
    const requests: Request[] = [];
    try {
      for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
      globalThis.fetch = (input, init) => {
        const req = new Request(input, init);
        requests.push(req);
        return Promise.resolve(stub?.(req, new URL(req.url)) ?? Response.json([], { status: 418 }));
      };
      await test(requests);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
    }
  };
}

function adminLookup(req: Request, url: URL): Response | undefined {
  if (url.pathname === "/auth/v1/user") {
    const token = req.headers.get("authorization");
    assertEquals(req.headers.get("apikey"), publicKey);
    if (token === `Bearer ${invalidSession}`) {
      return Response.json({ message: "invalid JWT" }, { status: 401 });
    }
    return Response.json({ id: token === `Bearer ${adminSession}` ? "admin-user" : "member-user" });
  }
  if (url.pathname === "/rest/v1/user_flags") {
    assertEquals(req.headers.get("apikey"), serviceKey);
    assertEquals(req.headers.get("authorization"), null);
    return Response.json([{ is_admin: url.searchParams.get("user_id") === "eq.admin-user" }]);
  }
}

const admin = { Authorization: `Bearer ${adminSession}` };
const cron = { [dailyPickCron.header]: cronToken };
const pipeline = { [scheduleVerification.header]: verificationToken };
const handlers: EdgeHandler[] = [dailyPick, mlbHealth, verifySchedule, runPipeline];

Deno.test("all handlers reject missing credentials and public or legacy API keys", mock(async (requests) => {
  for (const handler of handlers) {
    assertEquals((await handler(request())).status, 401);
    for (const key of [env.SUPABASE_ANON_KEY, env.SUPABASE_SERVICE_ROLE_KEY, publicKey, serviceKey]) {
      assertEquals((await handler(request({ Authorization: `Bearer ${key}`, apikey: key }))).status, 401);
    }
  }
  assertEquals(requests.length, 0);
}));

Deno.test("all handlers accept preflight and reject non-POST methods without side effects", mock(async (requests) => {
  for (const handler of handlers) {
    const preflight = await handler(new Request("https://edge.invalid/", { method: "OPTIONS" }));
    assertEquals(preflight.status, 200);
    assertEquals(preflight.headers.get("access-control-allow-origin"), "*");
    const get = await handler(new Request("https://edge.invalid/", { headers: admin }));
    assertEquals(get.status, 405);
    assertEquals(get.headers.get("allow"), "POST, OPTIONS");
  }
  assertEquals(requests.length, 0);
}));

Deno.test("member sessions lack admin privileges and invalid sessions are rejected", mock(async (requests) => {
  for (const handler of [dailyPick, mlbHealth]) {
    assertEquals((await handler(request({ Authorization: `Bearer ${memberSession}` }))).status, 403);
    assertEquals((await handler(request({ Authorization: `Bearer ${invalidSession}` }))).status, 401);
  }
  assertEquals(requests.map((req) => new URL(req.url).pathname), [
    "/auth/v1/user", "/rest/v1/user_flags", "/auth/v1/user",
    "/auth/v1/user", "/rest/v1/user_flags", "/auth/v1/user",
  ]);
}, adminLookup));

Deno.test("an admin flag lookup failure blocks the health check without exposing details", mock(async (requests) => {
  const response = await mlbHealth(request(admin));
  assertEquals(response.status, 403);
  assertEquals(await response.json(), { ok: false, error: "Admin access required" });
  assertEquals(requests.map((req) => new URL(req.url).pathname), ["/auth/v1/user", "/rest/v1/user_flags"]);
}, (req, url) => url.pathname === "/rest/v1/user_flags"
  ? Response.json({ message: "private database error" }, { status: 500 })
  : adminLookup(req, url)!));

Deno.test("the NBA and WNBA cron requests reach the idempotent daily-pick path", mock(async (requests) => {
  for (const sport of ["NBA", "WNBA"]) {
    const res = await dailyPick(request(cron, { sport, game_date: "2026-04-19" }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.skipped, true);
    assertEquals(body.sport, sport);
  }
  assertEquals(requests.map((req) => [
    req.method, new URL(req.url).pathname, new URL(req.url).searchParams.get("sport"),
  ]), [
    ["GET", "/rest/v1/ai_daily_picks", "eq.NBA"],
    ["GET", "/rest/v1/ai_daily_picks", "eq.WNBA"],
  ]);
}, () => Response.json([{ id: "existing-pick" }])));

Deno.test("the cron caller cannot force regeneration through query or body", mock(async (requests) => {
  assertEquals((await dailyPick(request(cron, { force: true }))).status, 403);
  assertEquals((await dailyPick(request(cron, { force: false }, "?force=true"))).status, 403);
  assertEquals(requests.length, 0);
}));

Deno.test("an admin can authorize the existing force-regeneration path", mock(async (requests) => {
  const res = await dailyPick(request(admin, { sport: "NBA", force: true, game_date: "2026-04-19" }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).reason, "no_candidates");
  assertEquals(requests.map((req) => [req.method, new URL(req.url).pathname]), [
    ["GET", "/auth/v1/user"],
    ["GET", "/rest/v1/user_flags"],
    ["GET", "/rest/v1/ai_daily_picks"],
    ["DELETE", "/rest/v1/ai_daily_picks"],
    ["GET", "/rest/v1/player_prop_scores"],
  ]);
}, (req, url) => adminLookup(req, url) ?? (url.pathname === "/rest/v1/ai_daily_picks"
  ? (req.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json([{ id: "old-pick" }]))
  : Response.json([]))));

Deno.test("a valid admin reaches the MLB checks and can write a report", mock(async (requests) => {
  const response = await mlbHealth(request(admin, { game_date: "2026-04-19" }));
  assertEquals(response.status, 200);
  assertEquals((await response.json()).game_date, "2026-04-19");
  assert(requests.some((req) => req.method === "POST" && new URL(req.url).pathname === "/rest/v1/mlb_refresh_health"));
}, (req, url) => adminLookup(req, url) ??
  (["HEAD", "POST"].includes(req.method) ? new Response(null, { status: 204 }) : Response.json([]))));

Deno.test("verify-schedule accepts only the pipeline secret and checks the provider", mock(async (requests) => {
  for (const headers of [admin, cron, { [scheduleVerification.header]: "x".repeat(64) }]) {
    assertEquals((await verifySchedule(request(headers))).status, 401);
  }
  assertEquals((await dailyPick(request(pipeline))).status, 401);
  assertEquals((await dailyPick(request({ [dailyPickCron.header]: "x".repeat(64) }))).status, 401);
  assertEquals((await mlbHealth(request(pipeline))).status, 401);
  assertEquals(requests.length, 0);

  const res = await verifySchedule(request(pipeline, { sports: ["NBA"], game_date: "2026-04-19" }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
  assertEquals(requests.length, 2);
  const [provider, database] = requests;
  assertEquals(provider.headers.get("Ocp-Apim-Subscription-Key"), fakeProviderKey);
  assertEquals(provider.redirect, "error");
  assertEquals(new URL(provider.url).search, "");
  assertEquals(new URL(database.url).pathname, "/rest/v1/games_today");
}, () => Response.json([])));

Deno.test("missing or weak machine secrets fail closed before all external work", mock(async (requests) => {
  Deno.env.delete(dailyPickCron.env);
  Deno.env.set(scheduleVerification.env, "weak");
  assertEquals((await dailyPick(request(cron))).status, 503);
  assertEquals((await verifySchedule(request(pipeline))).status, 503);
  assertEquals(requests.length, 0);
}));

Deno.test("a missing service configuration fails without making an auth request", mock(async (requests) => {
  Deno.env.set("SUPABASE_SECRET_KEYS", "{}");
  const res = await mlbHealth(request(admin));
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { ok: false, error: "Authorization unavailable" });
  assertEquals(requests.length, 0);
}));

Deno.test("provider failure is reported without the provider response or database writes", mock(async (requests) => {
  const res = await verifySchedule(request(pipeline, { sports: ["NBA"], game_date: "2026-04-19" }));
  const payload = await res.text();
  assertEquals(res.status, 200);
  assertStringIncludes(payload, "SportsData.io HTTP 503");
  assert(!payload.includes(fakeProviderKey));
  assertEquals(requests.length, 1);
}, () => new Response(fakeProviderKey, { status: 503 })));

Deno.test("missing provider configuration and malformed dates fail without external work", mock(async (requests) => {
  assertEquals((await verifySchedule(request(pipeline, { game_date: "2026-04-19?key=unexpected" }))).status, 400);
  Deno.env.delete("SPORTSDATAIO_API_KEY");
  const response = await verifySchedule(request(pipeline));
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { ok: false, error: "Schedule verification unavailable" });
  assertEquals(requests.length, 0);
}));

const startPipeline = { [pipelineCron.header]: env[pipelineCron.env] };

Deno.test("the pipeline sends only the dedicated verification secret and records an auth rejection", mock(async (requests) => {
  const res = await runPipeline(request(startPipeline, { sports: ["NBA"] }));
  assertEquals(res.status, 207);
  const summary = await res.json();
  assertEquals(summary.results.NBA.schedule_verification.status, "failed");
  assertEquals(summary.results.NBA.scoring.status, "success");
  assertStringIncludes(summary.errors[0], "HTTP 401");
  const verification = requests.find((req) => new URL(req.url).pathname === "/functions/v1/verify-schedule");
  assert(verification);
  assertEquals(verification.headers.get(scheduleVerification.header), verificationToken);
  assertEquals(verification.headers.get("Authorization"), null);
  assertEquals(verification.headers.get("x-admin-secret"), null);
  assertEquals((await verification.json()).sports, ["NBA"]);
}, (_req, url) => url.pathname === "/functions/v1/verify-schedule"
  ? Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  : Response.json({ ok: true })));

Deno.test("the pipeline skips the verification call when its secret is missing", mock(async (requests) => {
  Deno.env.delete(scheduleVerification.env);
  const res = await runPipeline(request(startPipeline, { sports: ["NBA"] }));
  assertEquals(res.status, 207);
  const summary = await res.json();
  assertEquals(summary.results.NBA.schedule_verification.status, "failed");
  assertEquals(summary.results.NBA.scoring.status, "success");
  assert(!requests.some((req) => new URL(req.url).pathname === "/functions/v1/verify-schedule"));
}, () => Response.json({ ok: true })));

Deno.test("internal DB and Edge calls use apikey, and an HTTP failure is a failed step", mock(async (requests) => {
  const res = await runPipeline(request(startPipeline, { sports: ["NBA"] }));
  assertEquals(res.status, 207);
  const summary = await res.json();
  assertEquals(summary.results.NBA.availability_refresh.status, "failed");
  for (const call of requests.filter((req) => !req.url.endsWith("/verify-schedule"))) {
    assertEquals(call.headers.get("apikey"), serviceKey);
    assertEquals(call.headers.get("authorization"), null);
    assertEquals(call.redirect, "error");
  }
  const lines = requests.find((call) => call.url.endsWith("/collect-line-snapshots"))!;
  assertEquals(await lines.json(), { sport: "NBA", skip_downstream: true });
}, (_req, url) => url.pathname.endsWith("/refresh-availability")
  ? Response.json({ error: "private rejection" }, { status: 401 })
  : url.pathname.endsWith("/verify-schedule")
    ? Response.json({ ok: true, sports: { NBA: {} } })
    : Response.json({ ok: true })));

Deno.test("only scoped scheduler headers open the pipeline and pick handlers", mock(async (requests) => {
  for (const headers of [cron, pipeline, { apikey: serviceKey }, { "x-admin-secret": env.REFRESH_SECRET }]) {
    assertEquals((await runPipeline(request(headers))).status, 401);
  }
  assertEquals((await dailyPick(request(startPipeline))).status, 401);
  assertEquals((await mlbHealth(request(startPipeline))).status, 401);
  assertEquals(requests.length, 0);
}));

Deno.test("existing backend callers migrate to apikey while the refresh header still works for scoring", mock(async (requests) => {
  for (const gate of [requireAdmin, requireAuth]) {
    assertEquals((await gate(request({ apikey: serviceKey }))).isServiceRole, true);
    for (const key of [publicKey, serviceKey, session("service", "service_role"), session("anonymous", "anon")]) {
      assertEquals((await gate(request({ Authorization: `Bearer ${key}` }))).status, 401);
    }
    assertEquals((await gate(request({ apikey: publicKey }))).status, 401);
  }
  assertEquals((await requireAdmin(request({ "x-admin-secret": env.REFRESH_SECRET }))).isServiceRole, true);
  assertEquals((await requireAdmin(request(startPipeline))).status, 401);
  assertEquals((await requireAdmin(request(startPipeline), pipelineCron)).isServiceRole, true);
  assertEquals(requests.length, 0);
}));

Deno.test("malformed modern configuration does not fall back to legacy keys", mock(async (requests) => {
  for (const invalid of ["{", "{}", JSON.stringify({ default: env.SUPABASE_SERVICE_ROLE_KEY })]) {
    Deno.env.set("SUPABASE_SECRET_KEYS", invalid);
    assertEquals((await runPipeline(request(startPipeline))).status, 503);
    assertEquals((await requireAdmin(request(admin))).status, 503);
  }
  assertEquals(requests.length, 0);
}));

Deno.test("refresh writers reject anonymous and fabricated credentials before data or provider access", mock(async (requests) => {
  const credentials: HeadersInit[] = [
    {}, { apikey: publicKey }, { Authorization: "Bearer eyJfixture" },
    { Authorization: `Bearer ${session("fixture", "service_role")}` },
  ];
  for (const handler of refreshHandlers) {
    for (const headers of credentials) {
      assertEquals((await handler(request(headers))).status, 401);
    }
  }
  assertEquals(requests.length, 0);
}));
