import { isFilters, isPlayerId, isRecord, type Filters } from "./contract.ts";

export type ContextState =
  | { kind: "resolved"; filters: Filters; playerId: number }
  | { kind: "clarify"; filters: Filters; choices: number[] };

const encoder = new TextEncoder();
const lifetime = 10 * 60 * 1000;

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
}

export function contextCodec(secret: string, userId: string) {
  const key = crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
  const message = (payload: string) => encoder.encode(JSON.stringify(["betstreaks.analytics.context.v1", userId, payload]));
  return {
    async sign(state: ContextState, now: number): Promise<string> {
      const payload = encode(encoder.encode(JSON.stringify({ ...state, exp: now + lifetime })));
      const signature = await crypto.subtle.sign("HMAC", await key, message(payload));
      return payload + "." + encode(new Uint8Array(signature));
    },
    async read(token: string, now: number): Promise<ContextState | undefined> {
      try {
        const [payload, signature, extra] = token.split(".");
        if (!payload || !signature || extra !== undefined ||
            !await crypto.subtle.verify("HMAC", await key, decode(signature), message(payload))) return;
        const decoded: unknown = JSON.parse(new TextDecoder().decode(decode(payload)));
        if (!isRecord(decoded) || Object.keys(decoded).length !== 4 ||
            typeof decoded.exp !== "number" || !Number.isSafeInteger(decoded.exp) ||
            decoded.exp <= now || decoded.exp > now + lifetime || !isFilters(decoded.filters)) return;
        if (decoded.kind === "resolved" && isPlayerId(decoded.playerId)) {
          return { kind: "resolved", filters: decoded.filters, playerId: decoded.playerId };
        }
        if (decoded.kind === "clarify" && Array.isArray(decoded.choices) &&
            decoded.choices.length > 1 && decoded.choices.length <= 5 &&
            decoded.choices.every(isPlayerId)) {
          return { kind: "clarify", filters: decoded.filters, choices: decoded.choices };
        }
      } catch {
        // Invalid encoding or signature.
      }
    },
  };
}
