import { withPrivilegedPost } from "../_shared/privilegedPost.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(withPrivilegedPost({ corsHeaders, adminUser: true }, () =>
  Promise.resolve(Response.json({
    ok: true,
    message: "NBA game-log refresh runs on the designated Mac. The operator can check the LaunchAgent status or request a manual run.",
    info: {
      schedule: "See the installed com.betstreaks.refresh schedule",
      manual_trigger: "Follow ops/REFRESH_SETUP_MAC.md on the designated Mac",
    },
    ran_at: new Date().toISOString(),
  }, { headers: corsHeaders })),
));
