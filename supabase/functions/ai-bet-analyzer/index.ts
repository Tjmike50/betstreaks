import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });

    // Service role client for usage tracking (bypasses RLS)
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { legs } = await req.json();
    if (!legs || !Array.isArray(legs) || legs.length === 0) {
      throw new Error("legs array is required");
    }

    // Check user auth & premium for free limit
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Authentication required. Please log in." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    let isPremium = false;

    {
      const { data: flags } = await supabase
        .from("user_flags")
        .select("is_premium")
        .eq("user_id", user.id)
        .single();
      isPremium = flags?.is_premium ?? false;

      if (!isPremium) {
        const today = new Date().toISOString().split("T")[0];
        const { data: usage } = await supabase
          .from("ai_usage")
          .select("request_count")
          .eq("user_id", user.id)
          .eq("usage_date", today)
          .single();

        if (usage && usage.request_count >= 1) {
          return new Response(
            JSON.stringify({ error: "free_limit_reached", message: "Free users get 1 AI analysis per day. Upgrade for unlimited." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    const systemPrompt = `You are an NBA betting analyst for BetStreaks. Analyze bet slips and provide structured grades.

RULES:
- Never say "lock", "guaranteed", or "sure thing"
- Use fair, data-driven language
- Grade on A/B/C/D/F scale
- Identify correlations (same-game legs that depend on each other)

Respond with ONLY valid JSON matching this structure:
{
  "overall_grade": "A" | "B" | "C" | "D" | "F",
  "overall_reasoning": "2-3 sentence overall assessment",
  "strongest_leg": {
    "leg_index": 0,
    "reasoning": "Why this is the strongest"
  },
  "weakest_leg": {
    "leg_index": 1,
    "reasoning": "Why this is the weakest"
  },
  "correlation_warnings": ["Warning about correlated legs if any"],
  "risk_label": "safe" | "balanced" | "aggressive",
  "safer_rebuild": {
    "slip_name": "Safer Version",
    "estimated_odds": "+120",
    "reasoning": "Brief explanation",
    "legs": [{ "player_name": "", "team_abbr": "", "stat_type": "", "line": "", "pick": "", "odds": "", "reasoning": "" }]
  },
  "aggressive_rebuild": {
    "slip_name": "Higher Payout Version",
    "estimated_odds": "+350",
    "reasoning": "Brief explanation",
    "legs": [{ "player_name": "", "team_abbr": "", "stat_type": "", "line": "", "pick": "", "odds": "", "reasoning": "" }]
  }
}`;

    const userPrompt = `Analyze this bet slip:\n${JSON.stringify(legs, null, 2)}`;

    const aiRes = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI service temporarily unavailable." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI analysis failed");
    }

    const aiData = await aiRes.json();
    let content = aiData.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI analysis:", content);
      throw new Error("AI returned invalid format");
    }

    // Track usage
    if (user && !isPremium) {
      const today = new Date().toISOString().split("T")[0];
      supabase
        .from("ai_usage")
        .upsert({ user_id: user.id, usage_date: today, request_count: 1 }, { onConflict: "user_id,usage_date" })
        .then(() => {});
    }

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-bet-analyzer error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
