import { requireAdmin, requireAuth } from "../_shared/adminAuth.ts";
import { createEdgeClient, readSecretKey } from "../_shared/supabaseKeys.ts";
import { fixtureSource } from "../_shared/analyticsAssistant/fixtures.ts";
import { fixtureBoard } from "../_shared/nbaWorkflow/fixtures.ts";
import { createWorkflowHandler } from "../_shared/nbaWorkflow/handler.ts";
import { googlePlan } from "../_shared/nbaWorkflow/planner.ts";
import { databaseStore, loadVerifiedSource, memoryStore } from "../_shared/nbaWorkflow/store.ts";
import { createWorkflow } from "../_shared/nbaWorkflow/workflow.ts";

const mode = Deno.env.get("NBA_WORKFLOW_MODE");
const url = Deno.env.get("SUPABASE_URL");
const secret = readSecretKey();
const database = url && secret ? createEdgeClient(url, secret) : undefined;
const googleKey = Deno.env.get("LOVABLE_API_KEY");
const googleModel = Deno.env.get("NBA_WORKFLOW_GOOGLE_MODEL");
const origins = (Deno.env.get("ANALYTICS_ALLOWED_ORIGINS") ?? "http://localhost:8080,http://127.0.0.1:8080")
  .split(",").map((origin) => origin.trim()).filter((origin) => /^https?:\/\/[\w.-]+(?::\d+)?$/.test(origin));
const globalLimit = Number(Deno.env.get("NBA_WORKFLOW_MODEL_DAILY_LIMIT") ?? 200);
const userLimit = Number(Deno.env.get("NBA_WORKFLOW_MODEL_USER_DAILY_LIMIT") ?? 15);
const pushPublicKey = Deno.env.get("NBA_WORKFLOW_VAPID_PUBLIC_KEY");
const pushReady = mode === "verified" && pushPublicKey && Deno.env.get("NBA_WORKFLOW_VAPID_PRIVATE_KEY") &&
  Deno.env.get("NBA_WORKFLOW_VAPID_SUBJECT");

Deno.serve(createWorkflowHandler({
  authenticate: requireAuth,
  isAdmin: async (req) => {
    const result = await requireAdmin(req);
    return result.ok && !!result.userId && !result.isServiceRole;
  },
  origins,
  workflow: createWorkflow({
    store: database ? databaseStore(database) : memoryStore(),
    source: (signal) => {
      if (mode === "fixture") return { board: fixtureBoard, logs: fixtureSource };
      if (mode === "verified" && database) return loadVerifiedSource(database, signal);
    },
    pushPublicKey: pushReady ? pushPublicKey : undefined,
    plan: (mode === "verified" || mode === "fixture") && database && googleKey && googleModel?.startsWith("google/gemini-") &&
        Number.isInteger(globalLimit) && globalLimit > 0 && Number.isInteger(userLimit) && userLimit > 0
      ? async (userId, question, defaults, signal) => {
        const { data, error } = await database.rpc("reserve_nba_workflow_model", {
          p_user: userId, p_global_limit: globalLimit, p_user_limit: userLimit,
        }).abortSignal(signal);
        if (error || data !== true) return;
        return await googlePlan({
          key: googleKey, model: googleModel, question, defaults,
          signal: AbortSignal.any([signal, AbortSignal.timeout(4500)]),
        });
      } : undefined,
  }),
  log: (event) => console.info(JSON.stringify(event)),
}));
