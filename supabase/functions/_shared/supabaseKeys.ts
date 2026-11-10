import { createClient, type SupabaseClientOptions } from "https://esm.sh/@supabase/supabase-js@2.91.1";

type ReadEnv = (name: string) => string | undefined;
const runtimeEnv: ReadEnv = (name) => Deno.env.get(name);

function readKey(env: ReadEnv, name: "PUBLISHABLE" | "SECRET"): string | undefined {
  const keyMap = env(`SUPABASE_${name}_KEYS`);
  let value: unknown;
  try {
    value = keyMap === undefined
      ? env(`SUPABASE_${name}_KEY`)
      : JSON.parse(keyMap)?.default;
  } catch {
    return undefined;
  }
  const format = name === "PUBLISHABLE" ? /^sb_publishable_[\w-]+$/ : /^sb_secret_[\w-]+$/;
  return typeof value === "string" && format.test(value) ? value : undefined;
}

export const readPublishableKey = (env: ReadEnv = runtimeEnv) => readKey(env, "PUBLISHABLE");
export const readSecretKey = (env: ReadEnv = runtimeEnv) => readKey(env, "SECRET");

export function supabaseKeyFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    // Older SDKs fill the bearer header with the app key when there is no session.
    if (headers.get("authorization") === `Bearer ${key}`) headers.delete("authorization");
    return fetch(input, { ...init, headers, redirect: "error" });
  };
}

export function createEdgeClient(
  url: string,
  key: string,
  options?: SupabaseClientOptions<"public">,
) {
  return createClient(url, key, {
    ...options,
    auth: { persistSession: false, autoRefreshToken: false, ...options?.auth },
    global: { ...options?.global, fetch: supabaseKeyFetch(key) },
  });
}

export function readUserBearer(req: Request): string | undefined {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return undefined;
  const [, payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return undefined;
  try {
    // This only rejects non-user credentials early. Supabase Auth verifies the token.
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof claims.sub === "string" && claims.sub &&
        claims.role !== "anon" && claims.role !== "service_role" ? token : undefined;
  } catch {
    return undefined;
  }
}
