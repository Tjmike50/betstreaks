import { verifiedSource } from "../supabase/functions/_shared/nbaWorkflow/store.ts";

if (Deno.args.length < 1 || Deno.args.length > 2 || (Deno.args[1] && Deno.args[1] !== "--publish")) {
  throw new Error("Give a snapshot JSON path and optionally --publish.");
}
const file = await Deno.readFile(Deno.args[0]);
if (file.byteLength > 16_000_000) throw new Error("Snapshot exceeds 16 MB.");
const payload = JSON.parse(new TextDecoder().decode(file));
const source = verifiedSource(payload, new Date());
if (!source) throw new Error("Snapshot validation failed. Check market keys, provenance, timestamps and appearance coverage.");
console.log(`Validated ${source.board.snapshot.revision} with ${source.board.markets.length} markets.`);

if (Deno.args[1] === "--publish") {
  const project = Deno.env.get("NBA_WORKFLOW_PROJECT_REF");
  const key = Deno.env.get("NBA_WORKFLOW_PUBLISHER_KEY");
  if (!project || !/^[a-z]{20}$/.test(project) || !key || !/^sb_secret_[\w-]+$/.test(key)) {
    throw new Error("Set NBA_WORKFLOW_PROJECT_REF and NBA_WORKFLOW_PUBLISHER_KEY in the approved publisher environment.");
  }
  const response = await fetch(`https://${project}.supabase.co/rest/v1/rpc/publish_nba_workflow_snapshot`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_payload: payload }),
  });
  if (!response.ok) throw new Error(`Snapshot was not accepted (HTTP ${response.status}).`);
  if (await response.json() !== true) throw new Error("A newer or conflicting snapshot is already published.");
  console.log("Snapshot published to the configured project.");
}
