import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Get auth token from header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized - missing token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const refreshSecret = Deno.env.get("REFRESH_SECRET")!;

    // Create client with user's token to verify auth
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the user
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await supabaseUser.auth.getUser(token);

    if (claimsError || !claims?.user) {
      console.error("Auth error:", claimsError);
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized - invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claims.user.id;
    console.log(`Admin refresh requested by user: ${userId}`);

    // Use service role to check admin status (bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userFlags, error: flagsError } = await supabaseAdmin
      .from("user_flags")
      .select("is_admin")
      .eq("user_id", userId)
      .single();

    if (flagsError || !userFlags?.is_admin) {
      console.error("User is not admin or flags error:", flagsError);
      return new Response(
        JSON.stringify({ ok: false, error: "Forbidden - admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Admin verified, triggering refresh functions...");

    // Parse request body for which functions to trigger
    const body = await req.json().catch(() => ({}));
    const triggerGames = body.games !== false;
    const triggerPlayers = body.players !== false;

    const results: Record<string, unknown> = {};

    // Call refresh-games-today
    if (triggerGames) {
      try {
        const gamesResponse = await fetch(`${supabaseUrl}/functions/v1/refresh-games-today`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-refresh-secret": refreshSecret,
          },
        });
        results.games = await gamesResponse.json();
      } catch (e) {
        console.error("Error calling refresh-games-today:", e);
        results.games = { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
      }
    }

    // Call refresh-players-and-streaks
    if (triggerPlayers) {
      try {
        const playersResponse = await fetch(`${supabaseUrl}/functions/v1/refresh-players-and-streaks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-refresh-secret": refreshSecret,
          },
        });
        results.players = await playersResponse.json();
      } catch (e) {
        console.error("Error calling refresh-players-and-streaks:", e);
        results.players = { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
      }
    }

    const duration = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        ok: true,
        ran_at: new Date().toISOString(),
        results,
        duration_ms: duration,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("admin-trigger-refresh failed:", error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
        duration_ms: duration,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
