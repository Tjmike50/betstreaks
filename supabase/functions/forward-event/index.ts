import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_EVENTS = new Set([
  "view_premium_page",
  "click_subscribe_monthly",
  "click_subscribe_yearly",
  "checkout_success",
  "checkout_cancel",
  "add_favorite",
  "share_streak",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { event_name, metadata } = body ?? {};

    if (!event_name || typeof event_name !== "string" || !ALLOWED_EVENTS.has(event_name)) {
      return new Response(
        JSON.stringify({ error: "Invalid event_name" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (metadata != null && (typeof metadata !== "object" || Array.isArray(metadata))) {
      return new Response(
        JSON.stringify({ error: "metadata must be an object" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Derive user_id from the verified caller JWT (never trust the body).
    let resolvedUserId: string | null = null;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length).trim();
      try {
        const supabaseAuth = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
        );
        const { data, error } = await supabaseAuth.auth.getUser(token);
        if (!error && data?.user?.id) {
          resolvedUserId = data.user.id;
        }
      } catch {
        // Fall through with null user_id (anonymous tracking allowed)
      }
    }

    const externalUrl = Deno.env.get("EXTERNAL_SUPABASE_URL");
    const externalKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");

    if (!externalUrl || !externalKey) {
      console.error("Missing EXTERNAL_SUPABASE_URL or EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
      return new Response(
        JSON.stringify({ error: "Server misconfigured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const externalSupabase = createClient(externalUrl, externalKey);

    const { error } = await externalSupabase
      .from("analytics_events")
      .insert({
        event_name,
        user_id: resolvedUserId,
        metadata: metadata ?? null,
      });

    if (error) {
      console.error("External insert failed:", error.message);
      return new Response(
        JSON.stringify({ error: "Failed to forward event" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("forward-event error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
