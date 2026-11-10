// Shared auth helper: verifies the caller is an admin (via user JWT + user_flags)
// OR is calling with the service-role key (for server-to-server invocations).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

export interface AdminAuthResult {
  ok: boolean;
  status: number;
  error?: string;
  userId?: string;
  isServiceRole?: boolean;
}

export async function requireAdmin(req: Request): Promise<AdminAuthResult> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const REFRESH_SECRET = Deno.env.get("REFRESH_SECRET") ?? "";

  // Allow internal cron / server-to-server calls bearing the shared secret
  const cronSecret = req.headers.get("x-admin-secret") ?? "";
  if (REFRESH_SECRET && cronSecret && cronSecret === REFRESH_SECRET) {
    return { ok: true, status: 200, isServiceRole: true };
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized — missing bearer token" };
  }
  const token = authHeader.slice("Bearer ".length).trim();

  // Allow service-role calls (used by internal server-to-server invocations)
  if (token === SERVICE_KEY) {
    return { ok: true, status: 200, isServiceRole: true };
  }

  return await verifyAdminUser(
    token,
    createClient(SUPABASE_URL, ANON_KEY),
    () => createClient(SUPABASE_URL, SERVICE_KEY),
  );
}

export async function verifyAdminUser(
  token: string,
  userClient: SupabaseClient,
  getAdminClient: () => SupabaseClient,
): Promise<AdminAuthResult> {
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: "Unauthorized — invalid token" };
  }
  const userId = userData.user.id;
  const { data: flags, error: flagsErr } = await getAdminClient()
    .from("user_flags")
    .select("is_admin")
    .eq("user_id", userId)
    .maybeSingle();

  if (flagsErr || flags?.is_admin !== true) {
    return { ok: false, status: 403, error: "Forbidden — admin access required" };
  }

  return { ok: true, status: 200, userId };
}

// Same as requireAdmin but only requires a valid signed-in user (or service role).
export async function requireAuth(req: Request): Promise<AdminAuthResult> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized — missing bearer token" };
  }
  const token = authHeader.slice("Bearer ".length).trim();

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  if (token === SERVICE_KEY) {
    return { ok: true, status: 200, isServiceRole: true };
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: "Unauthorized — invalid token" };
  }
  return { ok: true, status: 200, userId: userData.user.id };
}
