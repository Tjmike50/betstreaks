import { failure, type Reply } from "./contract.ts";

const windowMs = 60_000;

type Entry = {
  userId: string;
  fingerprint: string;
  expires: number;
  pending: boolean;
  reply: Promise<Reply>;
};

export function admission({ perUser = 30, concurrent = 2, total = 16, capacity = 512 } = {}) {
  const entries = new Map<string, Entry>();
  return function reserve(input: {
    userId: string; requestId: string; fingerprint: string; correlationId: string;
    now: number; run: () => Promise<Reply>;
  }): { reply: Promise<Reply>; replayed: boolean } {
    const { userId, requestId, fingerprint, correlationId, now, run } = input;
    const deny = (code: "RATE_LIMITED" | "REQUEST_CONFLICT") => ({
      reply: Promise.resolve({ ...failure(code), correlationId }), replayed: false,
    });

    const key = JSON.stringify([userId, requestId]);
    let userCount = 0;
    let userPending = 0;
    let allPending = 0;
    for (const [id, entry] of entries) {
      if (!entry.pending && entry.expires <= now) {
        entries.delete(id);
        continue;
      }
      if (entry.pending) allPending++;
      if (entry.userId === userId) {
        userCount++;
        if (entry.pending) userPending++;
      }
    }
    const existing = entries.get(key);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? { reply: existing.reply, replayed: true } : deny("REQUEST_CONFLICT");
    }
    if (userCount >= perUser || userPending >= concurrent || allPending >= total ||
        entries.size >= capacity) return deny("RATE_LIMITED");

    // No await between checking capacity and reserving. Duplicate requests share
    // the same bounded work and response within this Edge isolate.
    const reply = Promise.resolve().then(run).finally(() => {
      const entry = entries.get(key);
      if (entry) entry.pending = false;
    });
    entries.set(key, { userId, fingerprint, expires: now + windowMs, pending: true, reply });
    return { reply, replayed: false };
  };
}
