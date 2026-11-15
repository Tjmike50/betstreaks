import type { Appearance, GameLogSource } from "../analyticsAssistant/source.ts";
import { isDate, isPlayerId, isRecord, type Player } from "../analyticsAssistant/contract.ts";
import type { createEdgeClient } from "../supabaseKeys.ts";
import { emptyAccount, shortText, stamp, validBoard, type Account, type Board } from "./domain.ts";

export type Feedback = { reference: string; reason: string; created_at: string };
export type Source = { board: Board; logs: GameLogSource };
export type Store = {
  load(userId: string, signal: AbortSignal): Promise<Account>;
  update(userId: string, change: (account: Account) => Account, signal: AbortSignal): Promise<Account>;
  report(userId: string, reference: string, reason: string, signal: AbortSignal): Promise<void>;
  feedback(signal: AbortSignal): Promise<Feedback[]>;
};

export function memoryStore(): Store {
  const accounts = new Map<string, Account>();
  const reports = new Map<string, Feedback>();
  return {
    load: (userId) => Promise.resolve(accounts.get(userId) ?? emptyAccount()),
    update(userId, change) {
      const next = change(accounts.get(userId) ?? emptyAccount());
      accounts.set(userId, next);
      return Promise.resolve(next);
    },
    report(userId, reference, reason) {
      const key = JSON.stringify([userId, reference, reason]);
      if (reports.size < 100 && !reports.has(key)) reports.set(key, { reference, reason, created_at: new Date().toISOString() });
      return Promise.resolve();
    },
    feedback: () => Promise.resolve([...reports.values()].reverse().slice(0, 10)),
  };
}

type Client = ReturnType<typeof createEdgeClient>;

export function databaseStore(client: Client): Store {
  async function getRow(userId: string, signal: AbortSignal) {
    const { data, error } = await client.from("nba_workflow_accounts")
      .select("state, version").eq("user_id", userId).abortSignal(signal).maybeSingle();
    if (error) throw new Error("Account data unavailable");
    return data as { state: Account; version: number } | null;
  }

  return {
    async load(userId, signal) {
      return (await getRow(userId, signal))?.state ?? emptyAccount();
    },
    async update(userId, change, signal) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const row = await getRow(userId, signal);
        const previous = row?.state ?? emptyAccount();
        const next = change(previous);
        if (next === previous) return previous;
        if (!row) {
          const { error } = await client.from("nba_workflow_accounts")
            .insert({ user_id: userId, state: next, version: 1 }).abortSignal(signal);
          if (!error) return next;
          if (error.code === "23505") continue;
          throw new Error("Account write unavailable");
        }
        const { data, error } = await client.from("nba_workflow_accounts")
          .update({ state: next, version: row.version + 1 }).eq("user_id", userId).eq("version", row.version)
          .select("version").abortSignal(signal).maybeSingle();
        if (error) throw new Error("Account write unavailable");
        if (data) return next;
      }
      throw new Error("Concurrent account changes");
    },
    async report(userId, reference, reason, signal) {
      const { error } = await client.from("nba_workflow_feedback")
        .upsert({ user_id: userId, reference, reason }, { onConflict: "user_id,reference,reason", ignoreDuplicates: true })
        .abortSignal(signal);
      if (error) throw new Error("Feedback unavailable");
    },
    async feedback(signal) {
      const { data, error } = await client.from("nba_workflow_feedback")
        .select("reference, reason, created_at").order("created_at", { ascending: false }).limit(10).abortSignal(signal);
      if (error) throw new Error("Feedback unavailable");
      return data as Feedback[];
    },
  };
}

function validAppearance(value: unknown): value is Appearance {
  return isRecord(value) && value.sport === "NBA" && isPlayerId(value.player_id) &&
    shortText(value.game_id) && isDate(value.game_date) && stamp(value.updated_at) &&
    ["final", "dnp", "scheduled", "unknown"].includes(String(value.eligibility)) &&
    ["pts", "reb", "ast", "fg3m"].every((key) => value[key] === null ||
      (Number.isSafeInteger(value[key]) && Number(value[key]) >= 0));
}

export function verifiedSource(value: unknown, now: Date): Source | undefined {
  if (!isRecord(value) || !validBoard(value.board) || value.board.snapshot.mode !== "verified" ||
    Date.parse(value.board.asOf) > +now || !Array.isArray(value.appearances) || value.appearances.length > 30_000 ||
    !value.appearances.every(validAppearance) || !Array.isArray(value.completePlayerIds) ||
    !value.completePlayerIds.every(isPlayerId)) return undefined;
  const board = value.board;
  const appearances: Appearance[] = value.appearances;
  if (appearances.some((row) => row.game_date > board.snapshot.coverageThrough || row.updated_at > board.asOf)) return;
  const completePlayerIds = new Set(value.completePlayerIds);
  const players = [...new Map<number, Player>(board.markets.map(({ player }) => [player.id, player])).values()];
  return {
    board,
    logs: {
      snapshot: board.snapshot, players,
      readGames(query, signal) {
        signal.throwIfAborted();
        return Promise.resolve({
          complete: completePlayerIds.has(query.playerId),
          rows: appearances.filter((row) => row.player_id === query.playerId && row.game_date <= query.asOf),
        });
      },
    },
  };
}

export async function loadVerifiedSource(client: Client, signal: AbortSignal) {
  const { data, error } = await client.from("nba_workflow_snapshot")
    .select("payload").eq("id", true).abortSignal(signal).maybeSingle();
  if (error) throw new Error("Verified source unavailable");
  return verifiedSource(data?.payload, new Date());
}
