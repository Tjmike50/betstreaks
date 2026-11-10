import { timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import { verifyAdminUser } from "./adminAuth.ts";

export const dailyPickCron = {
  env: "DAILY_PICK_CRON_SECRET",
  header: "x-daily-pick-cron-secret",
};
export const scheduleVerification = {
  env: "SCHEDULE_VERIFICATION_SECRET",
  header: "x-schedule-verification-secret",
};

interface Secret {
  env: string;
  header: string;
}

interface CallerPolicy {
  corsHeaders: Record<string, string>;
  adminUser?: boolean;
  internal?: Secret;
}

export function readInternalSecret(secret: Secret): string | undefined {
  const value = Deno.env.get(secret.env);
  // Require an independently generated secret. Both callers and handlers fail closed.
  return value && /^[A-Za-z0-9_-]{32,}$/.test(value) ? value : undefined;
}

function matchesSecret(value: string, expected: string): boolean {
  if (value.length !== expected.length) return false;
  const encoder = new TextEncoder();
  const candidate = encoder.encode(value);
  const target = encoder.encode(expected);
  return candidate.length === target.length && timingSafeEqual(candidate, target);
}

function edgeKey(keyMap: string, legacyKey: string): string | undefined {
  const keys = Deno.env.get(keyMap);
  return keys === undefined ? Deno.env.get(legacyKey) : JSON.parse(keys)?.default;
}

export function withPrivilegedPost(
  policy: CallerPolicy,
  handler: (req: Request, context: {
    supabase: SupabaseClient;
    adminUserId: string | null;
  }) => Promise<Response>,
): (req: Request) => Promise<Response> {
  const headers = { ...policy.corsHeaders, "Content-Type": "application/json" };
  const deny = (status: number, error: string, extraHeaders = {}) =>
    Response.json({ ok: false, error }, { status, headers: { ...headers, ...extraHeaders } });

  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: policy.corsHeaders });
    if (req.method !== "POST") {
      return deny(405, "Method not allowed", { Allow: "POST, OPTIONS" });
    }

    try {
      const providedSecret = policy.internal ? req.headers.get(policy.internal.header) : null;
      const token = policy.adminUser
        ? /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") ?? "")?.[1]
        : undefined;

      if (providedSecret === null && !token) return deny(401, "Unauthorized");
      if (policy.internal && providedSecret !== null) {
        const expected = readInternalSecret(policy.internal);
        if (!expected) return deny(503, "Authorization unavailable");
        if (!matchesSecret(providedSecret, expected)) return deny(401, "Unauthorized");
      }

      const url = Deno.env.get("SUPABASE_URL");
      const serviceKey = edgeKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !serviceKey) return deny(503, "Authorization unavailable");

      const options = { auth: { persistSession: false, autoRefreshToken: false } };
      const supabase = createClient(url, serviceKey, options);
      let adminUserId: string | null = null;
      if (providedSecret === null) {
        const publicKey = edgeKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
        if (!publicKey) return deny(503, "Authorization unavailable");
        if (
          !token || token === publicKey || token === serviceKey ||
          token === Deno.env.get("SUPABASE_ANON_KEY") ||
          token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
        ) return deny(401, "Unauthorized");

        const auth = await verifyAdminUser(token, createClient(url, publicKey, options), () => supabase);
        if (!auth.ok || !auth.userId) {
          return auth.status === 403 ? deny(403, "Admin access required") : deny(401, "Unauthorized");
        }
        adminUserId = auth.userId;
      }

      return await handler(req, { supabase, adminUserId });
    } catch {
      console.error("[privileged-edge] Request failed");
      return deny(500, "Request failed");
    }
  };
}
