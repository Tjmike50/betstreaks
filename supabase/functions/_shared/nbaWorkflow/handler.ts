import type { AdminAuthResult } from "../adminAuth.ts";
import { createWorkflow, WorkflowError } from "./workflow.ts";

async function readPayload(req: Request, signal: AbortSignal) {
  if (!/^application\/json(?:;|$)/i.test(req.headers.get("content-type") ?? "") || !req.body) {
    throw new WorkflowError(400, "Send a JSON research request.");
  }
  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) throw new WorkflowError(413, "Research request is too large.");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    cancel();
    if (signal.aborted) throw new WorkflowError(504, "The research request timed out.");
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError(400, "Research request could not be read.");
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export function createWorkflowHandler(options: {
  authenticate: (req: Request) => Promise<AdminAuthResult>;
  isAdmin: (req: Request) => Promise<boolean>;
  origins: string[];
  workflow: ReturnType<typeof createWorkflow>;
  now?: () => Date;
  log?: (event: { event: string; reference: string; action: string; status: number; elapsedMs: number }) => void;
}) {
  let pending = 0;
  const activeUsers = new Map<string, number>();
  return async (req: Request) => {
    const origin = req.headers.get("origin");
    const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
    const reference = crypto.randomUUID();
    const start = performance.now();
    let action = "unknown";
    const reply = (status: number, body: Record<string, unknown>) => {
      options.log?.({ event: "nba_workflow", reference, action, status, elapsedMs: Math.round(performance.now() - start) });
      return Response.json({ ...body, reference }, { headers, status });
    };
    if (origin && !options.origins.includes(origin)) return reply(403, { error: "App origin unavailable." });
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    if (req.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
      return new Response(null, { status: 204, headers });
    }
    if (req.method !== "POST") return reply(405, { error: "Use POST for research." });
    if (pending >= 24) return reply(429, { error: "Research is busy. Try again shortly." });
    if (!req.headers.get("authorization")) return reply(401, { error: "Sign in to use NBA research." });

    pending++;
    let activeId: string | undefined;
    try {
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(8500)]);
      const auth = await options.authenticate(req);
      if (!auth.ok || !auth.userId || auth.isServiceRole) {
        return reply(auth.status >= 500 ? 503 : 401, { error: "Sign-in verification is unavailable." });
      }
      const active = activeUsers.get(auth.userId) ?? 0;
      if (active >= 3) return reply(429, { error: "Too many active research requests." });
      activeUsers.set(auth.userId, active + 1);
      activeId = auth.userId;
      const input = await readPayload(req, signal);
      if (input && ["load", "advance", "research", "diagnostics", "save", "remove", "watch", "unwatch",
        "preferences", "read", "push", "report"].includes(input.action)) action = input.action;
      signal.throwIfAborted();
      const data = await options.workflow(input, auth.userId, options.now?.() ?? new Date(), signal, () => options.isAdmin(req));
      return reply(200, { data });
    } catch (error) {
      return error instanceof WorkflowError ? reply(error.status, { error: error.message })
        : reply(503, { error: "NBA research is temporarily unavailable." });
    } finally {
      if (activeId) {
        const remaining = (activeUsers.get(activeId) ?? 1) - 1;
        if (remaining) activeUsers.set(activeId, remaining);
        else activeUsers.delete(activeId);
      }
      pending--;
    }
  };
}
