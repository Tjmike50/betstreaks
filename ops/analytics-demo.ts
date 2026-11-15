// Loopback-only demo for a Vite build configured with the documented fake key.
import { createAssistantHandler } from "../supabase/functions/_shared/analyticsAssistant/handler.ts";
import { fixtureSource } from "../supabase/functions/_shared/analyticsAssistant/fixtures.ts";

import { fixtureBoard, advanceFixture } from "../supabase/functions/_shared/nbaWorkflow/fixtures.ts";
import { createWorkflowHandler } from "../supabase/functions/_shared/nbaWorkflow/handler.ts";
import { memoryStore } from "../supabase/functions/_shared/nbaWorkflow/store.ts";
import { createWorkflow } from "../supabase/functions/_shared/nbaWorkflow/workflow.ts";

const portArg = Deno.args.find((value) => value.startsWith("--port="));
const directoryArg = Deno.args.find((value) => value.startsWith("--static-dir="));
const port = portArg ? Number(portArg.slice("--port=".length)) : 47961;
const staticDir = directoryArg?.slice("--static-dir=".length) ?? "dist";
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !staticDir) throw new Error("Invalid demo port or static directory.");
const host = "127.0.0.1";
const origin = `http://${host}:${port}`;
const failSource = Deno.args.includes("--fail-source");
if (Deno.args.some((value) => value !== "--fail-source" && value !== portArg && value !== directoryArg)) {
  throw new Error("Expected --fail-source, --port or --static-dir.");
}

const user = {
  id: "0ca8eb2a-4f15-4b44-bec5-cb9cb4b78773",
  email: "analyst@example.invalid",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-11-10T12:00:00.000Z",
};
const premiumUser = {
  ...user,
  id: "324f9561-433a-4146-9871-1347e9bf4e76",
  email: "premium@example.invalid",
};
const password = "demo-only-password";
const sessionLifetime = 3600;
const sessions = new Map<string, { expiry: number; account: typeof user }>();

function accountFor(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  const session = token ? sessions.get(token) : undefined;
  return session && session.expiry > Date.now() ? session.account : undefined;
}
const isSignedIn = (req: Request) => !!accountFor(req);
function auth(req: Request) {
  const account = accountFor(req);
  return Promise.resolve(account ? { ok: true, status: 200, userId: account.id } : { ok: false, status: 401 });
}

async function login(req: Request) {
  const credentials = await req.json().catch(() => null);
  const account = [user, premiumUser].find((candidate) => credentials?.email === candidate.email);
  if (!account || credentials?.password !== password) {
    return Response.json({ error: "invalid_grant", error_description: "Invalid demo login" }, { status: 400 });
  }
  for (const [key, { expiry }] of sessions) {
    if (expiry <= Date.now()) sessions.delete(key);
  }
  if (sessions.size >= 50) return Response.json({ message: "Restart the loopback demo." }, { status: 503 });
  const token = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + sessionLifetime;
  sessions.set(token, { expiry: expiresAt * 1000, account });
  return Response.json({
    access_token: token, refresh_token: "fixture-refresh-disabled", token_type: "bearer",
    expires_in: sessionLifetime, expires_at: expiresAt, user: account,
  });
}

const assistant = createAssistantHandler({
  authenticate: auth,
  secret: () => "loopback-demo-only-signing-material",
  source: failSource ? {
    ...fixtureSource,
    readGames: () => Promise.reject(new Error("Simulated offline source failure")),
  } : fixtureSource,
  origins: [origin],
  log: (event) => console.info(JSON.stringify(event)),
});

let demoBoard = fixtureBoard;
const workflow = createWorkflowHandler({
  authenticate: auth,
  isAdmin: (req) => Promise.resolve(accountFor(req)?.id === premiumUser.id),
  origins: [origin],
  workflow: createWorkflow({
    store: memoryStore(),
    source: () => ({ board: demoBoard, logs: fixtureSource }),
    advance: () => { if (demoBoard === fixtureBoard) demoBoard = advanceFixture(demoBoard); },
  }),
  log: (event) => console.info(JSON.stringify(event)),
});

const index = (await Deno.readTextFile(staticDir + "/index.html"))
  .replace(/<script async src="https:\/\/www\.googletagmanager\.com\/[^"]+"><\/script>\s*<script>[\s\S]*?<\/script>/, "")
  .replace(/<link rel="icon"[^>]+>/, '<link rel="icon" href="/favicon.png">');
const indexHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; connect-src 'self'; " +
    "img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
    "frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'",
};

Deno.serve({ hostname: host, port }, async (req) => {
  const url = new URL(req.url);
  if (url.origin !== origin || (req.headers.has("origin") && req.headers.get("origin") !== origin)) {
    return new Response(null, { status: 403 });
  }
  if (url.pathname === "/functions/v1/ai-analytics-assistant") return assistant(req);
  if (url.pathname === "/functions/v1/nba-workflow") return workflow(req);
  if (url.pathname === "/auth/v1/token" && req.method === "POST" && url.searchParams.get("grant_type") === "password") {
    return login(req);
  }
  if (url.pathname === "/auth/v1/user" && req.method === "GET" && isSignedIn(req)) return Response.json(accountFor(req));
  if (url.pathname === "/auth/v1/logout" && req.method === "POST") {
    sessions.delete(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/auth/v1/token") {
    return Response.json({ error: "invalid_grant", error_description: "Sign in again for a fresh demo session" }, { status: 400 });
  }
  if (url.pathname === "/rest/v1/rpc/get_premium_access" && req.method === "POST" && isSignedIn(req)) {
    const isPremium = accountFor(req)?.id === premiumUser.id;
    return Response.json({ base_premium: isPremium, is_premium: isPremium, weekly_expires_at: null });
  }
  if (url.pathname === "/rest/v1/user_flags" && req.method === "GET") {
    const isAdmin = accountFor(req)?.id === premiumUser.id;
    return Response.json([{ is_admin: isAdmin }]);
  }
  if (url.pathname === "/rest/v1/player_prop_scores") {
    const market = fixtureBoard.markets[0];
    if (req.method === "HEAD") return new Response(null, { headers: { "Content-Range": "*/0" } });
    if (req.method === "GET" && url.searchParams.get("select") === "game_date") return Response.json([{ game_date: market.date }]);
    if (req.method === "GET") return Response.json([{
      id: market.id, player_id: market.player.id, player_name: market.player.name, sport: "NBA",
      team_abbr: "BOS", opponent_abbr: "NYK", home_away: "home", stat_type: market.metric,
      threshold: market.quotes[0].line, confidence_score: 62, score_overall: 62, score_recent_form: 68,
      score_value: 64, last5_hit_rate: 20, last10_hit_rate: 40, last10_avg: 20, game_date: market.date,
    }]);
  }
  if (url.pathname.startsWith("/rest/v1/") && req.method === "GET") return Response.json([]);
  if (req.method !== "GET" || /^\/(?:auth|rest|functions)\/v1\//.test(url.pathname)) return new Response(null, { status: 404 });

  if ((url.pathname === "/favicon.png" || url.pathname === "/nba-research-push.js") || /^\/assets\/[\w.-]+\.(?:js|css|png|svg|woff2)$/.test(url.pathname)) {
    const contentType = {
      js: "text/javascript", css: "text/css", png: "image/png", svg: "image/svg+xml", woff2: "font/woff2",
    }[url.pathname.split(".").at(-1) ?? ""];
    if (!contentType) return new Response(null, { status: 404 });
    try {
      return new Response(await Deno.readFile(staticDir + url.pathname), { headers: { "Content-Type": contentType } });
    } catch {
      return new Response(null, { status: 404 });
    }
  }
  return new Response(index, { headers: indexHeaders });
});
