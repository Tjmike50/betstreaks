import { createEdgeClient, readUserBearer } from "../supabaseKeys.ts";
import { validSnapshot } from "./calculate.ts";
import type { Player, Snapshot } from "./contract.ts";
import type { Appearance, GameLog, GameLogSource } from "./source.ts";

const pageSize = 100;
const maxRows = 5000;
const columns = "sport,player_id,game_id,game_date,pts,reb,ast,fg3m,updated_at";

/**
 * Read-only adapter for a future authorized staging rehearsal. The production
 * handler registers only fixtureSource. Callers must verify the user session and
 * supply independently approved coverage and eligibility evidence.
 */
export function createVerifiedSupabaseSource(options: {
  verifiedRequest: Request;
  url: string;
  publishableKey: string;
  snapshot: Snapshot;
  players: readonly Player[];
  eligibility: ReadonlyMap<string, Appearance["eligibility"]>;
}): GameLogSource {
  const { verifiedRequest, url, publishableKey, snapshot, players, eligibility } = options;
  const token = readUserBearer(verifiedRequest);
  if (!token || !/^sb_publishable_[\w-]+$/.test(publishableKey) ||
      snapshot.mode !== "verified" || !validSnapshot(snapshot)) {
    throw new Error("Verified source configuration required");
  }
  const client = createEdgeClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  return {
    snapshot,
    players,
    async readGames(query, signal) {
      const rows: Appearance[] = [];
      let expectedCount: number | null = null;
      for (let offset = 0; offset < maxRows;) {
        const page = await client.from("player_recent_games").select(columns, { count: "exact" })
          .eq("sport", query.sport).eq("player_id", query.playerId).lte("game_date", query.asOf)
          .order("game_date", { ascending: false }).order("game_id", { ascending: false })
          .range(offset, offset + pageSize - 1).abortSignal(signal);
        if (page.error) throw new Error("Game log query failed");
        if (!page.data || page.count === null || page.count > maxRows ||
            (expectedCount !== null && page.count !== expectedCount)) return { rows: [], complete: false };

        expectedCount = page.count;
        for (const row of page.data as GameLog[]) {
          rows.push({ ...row, eligibility: eligibility.get(`${row.player_id}:${row.game_id}`) ?? "unknown" });
        }
        offset += page.data.length;
        if (offset === expectedCount) return { rows, complete: true };
        if (!page.data.length || offset > expectedCount) return { rows: [], complete: false };
      }
      return { rows: [], complete: false };
    },
  };
}
