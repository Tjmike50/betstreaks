import { requireAuth } from "../_shared/adminAuth.ts";
import { readSecretKey } from "../_shared/supabaseKeys.ts";
import { fixtureSource } from "../_shared/analyticsAssistant/fixtures.ts";
import { createAssistantHandler } from "../_shared/analyticsAssistant/handler.ts";

const origins = (Deno.env.get("ANALYTICS_ALLOWED_ORIGINS") ??
  "http://localhost:8080,http://127.0.0.1:8080")
  .split(",").map((value) => value.trim())
  .filter((value) => /^https?:\/\/[\w.-]+(?::\d+)?$/.test(value));

Deno.serve(createAssistantHandler({
  authenticate: requireAuth,
  secret: () => {
    const dedicated = Deno.env.get("ANALYTICS_CONTEXT_SECRET");
    return dedicated === undefined ? readSecretKey() : /^[\w-]{32,}$/.test(dedicated) ? dedicated : undefined;
  },
  source: fixtureSource,
  origins,
  log: (event) => console.info(JSON.stringify(event)),
}));
