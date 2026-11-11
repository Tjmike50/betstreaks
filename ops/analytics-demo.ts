// Loopback-only demo for a Vite build configured with the documented fake key.
import { createAssistantHandler } from "../supabase/functions/_shared/analyticsAssistant/handler.ts";
import { fixtureSource } from "../supabase/functions/_shared/analyticsAssistant/fixtures.ts";

const port = 47961;
const host = "127.0.0.1";
const origin = `http://${host}:${port}`;
const failSource = Deno.args.includes("--fail-source");
if (Deno.args.some((value) => value !== "--fail-source")) throw new Error("Expected no arguments or --fail-source.");

const user = {
  id: "0ca8eb2a-4f15-4b44-bec5-cb9cb4b78773",
  email: "analyst@example.invalid",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-11-10T12:00:00.000Z",
};
const password = "demo-only-password";
const sessionLifetime = 3600;
const sessions = new Map<string, number>();

function isSignedIn(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  return !!token && (sessions.get(token) ?? 0) > Date.now();
}

async function login(req: Request) {
  const credentials = await req.json().catch(() => null);
  if (credentials?.email !== user.email || credentials?.password !== password) {
    return Response.json({ error: "invalid_grant", error_description: "Invalid demo login" }, { status: 400 });
  }
  for (const [key, expiry] of sessions) {
    if (expiry <= Date.now()) sessions.delete(key);
  }
  if (sessions.size >= 50) return Response.json({ message: "Restart the loopback demo." }, { status: 503 });
  const token = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + sessionLifetime;
  sessions.set(token, expiresAt * 1000);
  return Response.json({
    access_token: token, refresh_token: "fixture-refresh-disabled", token_type: "bearer",
    expires_in: sessionLifetime, expires_at: expiresAt, user,
  });
}

const assistant = createAssistantHandler({
  authenticate: (req) => Promise.resolve(isSignedIn(req)
    ? { ok: true, status: 200, userId: user.id }
    : { ok: false, status: 401 }),
  secret: () => "loopback-demo-only-signing-material",
  source: failSource ? {
    ...fixtureSource,
    readGames: () => Promise.reject(new Error("Simulated offline source failure")),
  } : fixtureSource,
  origins: [origin],
  log: (event) => console.info(JSON.stringify(event)),
});

const index = (await Deno.readTextFile("dist/index.html"))
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
  if (url.pathname === "/auth/v1/token" && req.method === "POST" && url.searchParams.get("grant_type") === "password") {
    return login(req);
  }
  if (url.pathname === "/auth/v1/user" && req.method === "GET" && isSignedIn(req)) return Response.json(user);
  if (url.pathname === "/auth/v1/logout" && req.method === "POST") {
    sessions.delete(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/auth/v1/token") {
    return Response.json({ error: "invalid_grant", error_description: "Sign in again for a fresh demo session" }, { status: 400 });
  }
  if (url.pathname === "/rest/v1/rpc/get_premium_access" && req.method === "POST" && isSignedIn(req)) {
    return Response.json({ base_premium: false, is_premium: false, weekly_expires_at: null });
  }
  if (url.pathname.startsWith("/rest/v1/") && req.method === "GET") return Response.json([]);
  if (req.method !== "GET" || /^\/(?:auth|rest|functions)\/v1\//.test(url.pathname)) return new Response(null, { status: 404 });

  if (url.pathname === "/favicon.png" || /^\/assets\/[\w.-]+\.(?:js|css|png|svg|woff2)$/.test(url.pathname)) {
    const contentType = {
      js: "text/javascript", css: "text/css", png: "image/png", svg: "image/svg+xml", woff2: "font/woff2",
    }[url.pathname.split(".").at(-1) ?? ""];
    if (!contentType) return new Response(null, { status: 404 });
    try {
      return new Response(await Deno.readFile("dist" + url.pathname), { headers: { "Content-Type": contentType } });
    } catch {
      return new Response(null, { status: 404 });
    }
  }
  return new Response(index, { headers: indexHeaders });
});
