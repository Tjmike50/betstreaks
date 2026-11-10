import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import { matchesSecret, readInternalSecret, refreshCaller, type InternalSecret } from "./internalAuth.ts";
import { createEdgeClient, readPublishableKey, readSecretKey, readUserBearer } from "./supabaseKeys.ts";

export interface AdminAuthResult {
  ok: boolean;
  status: number;
  error?: string;
  userId?: string;
  isServiceRole?: boolean;
}

const unauthorized = { ok: false, status: 401, error: "Unauthorized" };
const unavailable = { ok: false, status: 503, error: "Authorization unavailable" };

export async function requireAdmin(req: Request, scheduler?: InternalSecret): Promise<AdminAuthResult> {
  if (matchesSecret(req.headers.get("apikey"), readSecretKey()) ||
      matchesSecret(req.headers.get(refreshCaller.header), readInternalSecret(refreshCaller)) ||
      (scheduler && matchesSecret(req.headers.get(scheduler.header), readInternalSecret(scheduler)))) {
    return { ok: true, status: 200, isServiceRole: true };
  }

  const token = readUserBearer(req);
  if (!token) return unauthorized;
  const url = Deno.env.get("SUPABASE_URL");
  const publicKey = readPublishableKey();
  const serviceKey = readSecretKey();
  if (!url || !publicKey || !serviceKey) return unavailable;

  return await verifyAdminUser(
    token,
    createEdgeClient(url, publicKey),
    () => createEdgeClient(url, serviceKey),
  );
}

export async function verifyAdminUser(
  token: string,
  userClient: SupabaseClient,
  getAdminClient: () => SupabaseClient,
): Promise<AdminAuthResult> {
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user) return unauthorized;

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

export async function requireAuth(req: Request): Promise<AdminAuthResult> {
  if (matchesSecret(req.headers.get("apikey"), readSecretKey())) {
    return { ok: true, status: 200, isServiceRole: true };
  }

  const token = readUserBearer(req);
  if (!token) return unauthorized;
  const url = Deno.env.get("SUPABASE_URL");
  const publicKey = readPublishableKey();
  if (!url || !publicKey) return unavailable;

  const { data, error } = await createEdgeClient(url, publicKey).auth.getUser(token);
  if (error || !data?.user) return unauthorized;
  return { ok: true, status: 200, userId: data.user.id };
}
