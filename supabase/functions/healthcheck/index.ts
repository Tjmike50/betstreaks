// Simple healthcheck endpoint - no authentication required
// Used to verify cron-job.org connectivity without secret issues

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const response = {
    ok: true,
    timestamp: new Date().toISOString(),
    message: "Healthcheck passed",
  };

  console.log("Healthcheck called:", response);

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
