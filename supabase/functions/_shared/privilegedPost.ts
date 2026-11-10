import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import { verifyAdminUser } from "./adminAuth.ts";
import { matchesSecret, readInternalSecret, type InternalSecret } from "./internalAuth.ts";
import { createEdgeClient, readPublishableKey, readSecretKey, readUserBearer } from "./supabaseKeys.ts";

interface CallerPolicy {
  corsHeaders: Record<string, string>;
  adminUser?: boolean;
  internal?: InternalSecret;
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
      const token = policy.adminUser ? readUserBearer(req) : undefined;

      if (providedSecret === null && !token) return deny(401, "Unauthorized");
      if (policy.internal && providedSecret !== null) {
        const expected = readInternalSecret(policy.internal);
        if (!expected) return deny(503, "Authorization unavailable");
        if (!matchesSecret(providedSecret, expected)) return deny(401, "Unauthorized");
      }

      const url = Deno.env.get("SUPABASE_URL");
      const serviceKey = readSecretKey();
      if (!url || !serviceKey) return deny(503, "Authorization unavailable");

      const supabase = createEdgeClient(url, serviceKey);
      let adminUserId: string | null = null;
      if (providedSecret === null) {
        const publicKey = readPublishableKey();
        if (!publicKey) return deny(503, "Authorization unavailable");
        if (!token) return deny(401, "Unauthorized");

        const auth = await verifyAdminUser(token, createEdgeClient(url, publicKey), () => supabase);
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
