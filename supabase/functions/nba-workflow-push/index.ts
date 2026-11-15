// @ts-types="npm:@types/web-push@3.6.4"
import webPush from "npm:web-push@3.6.7";
import { matchesSecret, readInternalSecret } from "../_shared/internalAuth.ts";
import { createEdgeClient, readSecretKey } from "../_shared/supabaseKeys.ts";
import { quietHours, reconcileWatch } from "../_shared/nbaWorkflow/domain.ts";
import { databaseStore, loadVerifiedSource } from "../_shared/nbaWorkflow/store.ts";
import { validSubscription } from "../_shared/nbaWorkflow/workflow.ts";

const secret = { env: "NBA_WORKFLOW_PUSH_CRON_SECRET", header: "x-nba-workflow-push-secret" };
const url = Deno.env.get("SUPABASE_URL");
const key = readSecretKey();
const publicKey = Deno.env.get("NBA_WORKFLOW_VAPID_PUBLIC_KEY");
const privateKey = Deno.env.get("NBA_WORKFLOW_VAPID_PRIVATE_KEY");
const subject = Deno.env.get("NBA_WORKFLOW_VAPID_SUBJECT");
const enabled = Deno.env.get("NBA_WORKFLOW_MODE") === "verified";
const client = url && key ? createEdgeClient(url, key) : undefined;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  if (!matchesSecret(req.headers.get(secret.header), readInternalSecret(secret))) {
    return new Response(null, { status: 401 });
  }
  if (!enabled || !client) return new Response(null, { status: 503 });

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(28_000)]);
  const now = new Date();
  const source = await loadVerifiedSource(client, signal).catch(() => undefined);
  if (!source) return new Response(null, { status: 503 });
  const result = await client.rpc("next_nba_workflow_watch_accounts").abortSignal(signal);
  if (result.error || !Array.isArray(result.data)) return new Response(null, { status: 503 });
  const store = databaseStore(client);
  const failures: string[] = [];
  let sent = 0;

  async function processAccount(userId: string) {
    const account = await store.update(userId, (current) => reconcileWatch(current, source!.board, now), signal);
    const subscription = account.subscription;
    if (!publicKey || !privateKey || !subject || !account.preferences.enabled || quietHours(account.preferences, now) || !validSubscription(subscription)) return;
    const update = account.updates.find((event) => !account.read.includes(event.id) &&
      +now - Date.parse(event.observedAt) <= 30 * 60_000);
    if (!update) return;
    const details = webPush.generateRequestDetails(subscription, undefined, {
      TTL: 600,
      vapidDetails: { publicKey, privateKey, subject },
    });
    const claim = await client!.from("nba_workflow_push_claims")
      .insert({ user_id: userId, event_id: update.id }).abortSignal(signal);
    if (claim.error?.code === "23505") return;
    if (claim.error) throw new Error("claim_unavailable");
    // The claim prevents a duplicate notification if the provider accepted a request but the response was lost.
    const response = await fetch(details.endpoint, {
      method: details.method, headers: details.headers, body: null, redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(3500)]),
    });
    void response.body?.cancel();
    if (response.ok) {
      sent++;
    } else if (response.status === 404 || response.status === 410) {
      await store.update(userId, (current) => current.subscription?.endpoint === subscription.endpoint
        ? { ...current, subscription: null } : current, signal);
    } else if (response.status === 429) {
      await client!.from("nba_workflow_push_claims").delete().eq("user_id", userId)
        .eq("event_id", update.id).abortSignal(signal);
      failures.push("provider_limited");
    } else {
      failures.push("provider_rejected");
    }
  }

  for (let offset = 0; offset < result.data.length && !signal.aborted; offset += 4) {
    const jobs = await Promise.allSettled(result.data.slice(offset, offset + 4).map(processAccount));
    for (const job of jobs) if (job.status === "rejected") failures.push("delivery_unavailable");
  }

  const claims = await client.from("nba_workflow_push_claims").delete()
    .lt("claimed_at", new Date(+now - 7 * 86_400_000).toISOString()).abortSignal(signal);
  if (claims.error) failures.push("cleanup_unavailable");
  const counts = { reviewed: result.data.length, sent, failures: failures.length };
  console.info(JSON.stringify({ event: "nba_workflow_push", ...counts }));
  return Response.json(counts, { status: signal.aborted ? 503 : 200 });
});
