import type { AdminAuthResult } from "../adminAuth.ts";
import { answer } from "./answer.ts";
import { admission } from "./admission.ts";
import { failure, parseRequest, type ErrorCode, type Reply } from "./contract.ts";
import type { GameLogSource } from "./source.ts";

const statusFor: Partial<Record<ErrorCode, number>> = {
  AUTH_REQUIRED: 401, AUTH_UNAVAILABLE: 503, ORIGIN_DENIED: 403, METHOD_NOT_ALLOWED: 405,
  INVALID_REQUEST: 400, REQUEST_TOO_LARGE: 413, SOURCE_UNAVAILABLE: 503,
  DATASET_UNAVAILABLE: 503, TIMEOUT: 504, RATE_LIMITED: 429, REQUEST_CONFLICT: 409,
};
const maxBytes = 4096;

class BadBody extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "REQUEST_TOO_LARGE") { super(code); }
}

async function readBody(req: Request, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "") || !req.body) {
    throw new BadBody("INVALID_REQUEST");
  }
  if (Number(req.headers.get("content-length")) > maxBytes) throw new BadBody("REQUEST_TOO_LARGE");
  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new BadBody("REQUEST_TOO_LARGE");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    abort();
    if (error instanceof BadBody || signal.aborted) throw error;
    throw new BadBody("INVALID_REQUEST");
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

function within<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export type LogEvent = {
  event: "analytics_assistant";
  correlationId: string;
  outcome: string;
  elapsedMs: number;
  replayed: boolean;
  mode: "fixture" | "verified" | "unavailable";
};

export function createAssistantHandler(options: {
  authenticate: (req: Request) => Promise<AdminAuthResult>;
  secret: () => string | undefined;
  source: GameLogSource;
  origins: readonly string[];
  now?: () => Date;
  log?: (event: LogEvent) => void;
  timeoutMs?: number;
  limits?: Parameters<typeof admission>[0];
}) {
  const reserve = admission(options.limits);
  const now = options.now ?? (() => new Date());
  const timeout = options.timeoutMs ?? 4000;
  let authPending = 0;

  return async (req: Request): Promise<Response> => {
    const start = performance.now();
    const correlationId = crypto.randomUUID();
    const origin = req.headers.get("origin");
    const allowed = origin === null || options.origins.includes(origin);
    const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
    if (origin && allowed) headers.set("Access-Control-Allow-Origin", origin);
    const reply = (result: Reply, replayed = false) => {
      options.log?.({
        event: "analytics_assistant", correlationId: result.correlationId,
        outcome: result.status === "answer" ? "ANSWER" : result.code,
        elapsedMs: Math.round(performance.now() - start), replayed,
        mode: options.source.snapshot?.mode ?? "unavailable",
      });
      const status = result.status === "error" ? statusFor[result.code] ?? 200 : 200;
      if (status === 405) headers.set("Allow", "POST, OPTIONS");
      if (status === 429) headers.set("Retry-After", "60");
      return Response.json(result, { status, headers });
    };
    const deny = (code: ErrorCode) => reply({ ...failure(code), correlationId });
    if (!allowed) return deny("ORIGIN_DENIED");
    if (req.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
      return new Response(null, { status: 204, headers });
    }
    if (req.method !== "POST") return deny("METHOD_NOT_ALLOWED");
    if (!req.headers.get("authorization")) return deny("AUTH_REQUIRED");

    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(timeout)]);
    try {
      const input = parseRequest(await readBody(req, signal));
      if (!input) return deny("INVALID_REQUEST");

      if (authPending >= 16) return deny("RATE_LIMITED");
      authPending++;
      const authentication = Promise.resolve().then(() => options.authenticate(req)).finally(() => authPending--);
      const auth = await within(authentication, signal);
      if (!auth.ok || !auth.userId || auth.isServiceRole) {
        return deny(auth.status >= 500 ? "AUTH_UNAVAILABLE" : "AUTH_REQUIRED");
      }
      const secret = options.secret();
      if (!secret) return deny("AUTH_UNAVAILABLE");

      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
      const fingerprint = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
      signal.throwIfAborted();
      const userId = auth.userId;
      const requestedAt = now();
      const reservation = reserve({
        userId, requestId: input.requestId, fingerprint, correlationId, now: +requestedAt,
        async run() {
          const workSignal = AbortSignal.timeout(timeout);
          try {
            const result = await within(answer(input, userId, secret, options.source, requestedAt, workSignal), workSignal);
            return { ...result, correlationId };
          } catch {
            return { ...failure(workSignal.aborted ? "TIMEOUT" : "SOURCE_UNAVAILABLE"), correlationId };
          }
        },
      });
      // The caller can leave without cancelling work shared by an identical retry.
      return reply(await within(reservation.reply, signal), reservation.replayed);
    } catch (error) {
      return deny(signal.aborted ? "TIMEOUT" : error instanceof BadBody ? error.code : "AUTH_UNAVAILABLE");
    }
  };
}
