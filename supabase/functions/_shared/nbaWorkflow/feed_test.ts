import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildNbaSnapshot, type FeedLog, type FeedTeamLog } from "./feed.ts";
import { reviewSlip, type Slip } from "./domain.ts";
import { verifiedSource } from "./store.ts";

const now = new Date("2026-11-14T22:00:00.000Z");
const today = "2026-11-14";
const observedAt = "2026-11-14T21:57:00.000Z";
const game = {
  id: "espn-fixture", game_date: today, home_team_abbr: "BOS", away_team_abbr: "NYK",
  verification_status: "verified", status: "Scheduled", is_postponed: false, updated_at: observedAt,
};
const score = {
  player_id: 1001, player_name: "Avery Stone", team_abbr: "BOS", opponent_abbr: "NYK", game_date: today,
  stat_type: "pts", threshold: 20, score_overall: 62, scored_at: observedAt,
};
const odds = {
  event_id: "odds-fixture", home_team: "Boston Celtics", away_team: "New York Knicks",
  commence_time: "2026-11-15T00:00:00Z", market_key: "player_points", bookmaker_key: "demo",
  provider: "the-odds-api", fetched_at: observedAt,
  odds_data: [{ description: "Avery Stone", name: "Over", point: 20, price: -110 }],
};
const teamLogs = Array.from({ length: 10 }, (_, index): FeedTeamLog => ({
  team_abbr: "BOS", game_id: `official-${index}`, game_date: `2026-11-${String(13 - index).padStart(2, "0")}`, wl: "W",
}));
const logs = teamLogs.map((row): FeedLog => ({
  sport: "NBA", player_id: 1001, game_id: row.game_id, game_date: row.game_date, wl: "W",
  matchup: "BOS vs. NYK", updated_at: observedAt, pts: 20, reb: 5, ast: 4, fg3m: 2,
}));
const feed = { games: [game], scores: [score], odds: [odds], logs, teamLogs };

Deno.test("feed match uses only verified event identity and attests a complete as-of window", async () => {
  const payload = buildNbaSnapshot(feed, now);
  assert(payload);
  assertEquals(payload.board.markets[0].quotes[0].observedAt, observedAt);
  assertEquals(payload.board.markets[0].eventId, game.id);
  assertEquals(payload.completePlayerIds, [1001]);
  const logs = verifiedSource(payload, now)?.logs;
  assert(logs);
  const signal = new AbortController().signal;
  const query = { sport: "NBA", playerId: 1001, metric: "PTS", asOf: "2026-11-13", window: 5,
    operation: { kind: "average" } } as const;
  assertEquals((await logs.readGames(query, signal)).complete, true);
  assertEquals((await logs.readGames({ ...query, asOf: "2026-11-12" }, signal)).complete, false);
  assertEquals(buildNbaSnapshot({ ...feed, logs: feed.logs.slice(1) }, now)?.completePlayerIds, []);
});

Deno.test("feed drops stale quotes, ambiguous schedule and players, and unverified schedule", () => {
  assertEquals(buildNbaSnapshot({ ...feed, odds: [{ ...odds, fetched_at: "2026-11-14T21:44:00Z" }] }, now), undefined);
  assertEquals(buildNbaSnapshot({ ...feed, teamLogs: [{ ...teamLogs[0], game_date: "2026-06-13" }] }, now), undefined);
  assertEquals(buildNbaSnapshot({ ...feed, games: [game, { ...game, id: "other" }] }, now), undefined);
  assertEquals(buildNbaSnapshot({ ...feed, scores: [score, { ...score, player_id: 1002 }] }, now), undefined);
  assertEquals(buildNbaSnapshot({ ...feed, games: [{ ...game, verification_status: "unverified" }] }, now), undefined);
});

Deno.test("same book tracks a line move and settles the saved threshold only with matching final team and player logs", () => {
  const start = buildNbaSnapshot(feed, now)?.board;
  assert(start);
  const market = start.markets[0];
  const slip: Slip = { id: "fixture", name: "Fixture", createdAt: observedAt, legs: [{ ...market, quote: market.quotes[0] }] };
  const changedAt = new Date("2026-11-14T22:05:00Z");
  const moved = buildNbaSnapshot({ ...feed, previous: start, odds: [{ ...odds, fetched_at: changedAt.toISOString(),
    odds_data: [{ ...odds.odds_data[0], point: 21 }] }] }, changedAt)?.board;
  assert(moved);
  assertEquals(reviewSlip(slip, moved, changedAt)[0].state, "line_moved");
  assertEquals(moved.markets[0].previousQuotes[0].line, 20);
  const finalAt = new Date("2026-11-15T02:45:00Z");
  const finalHome = { ...teamLogs[0], game_date: today, game_id: "official-today" };
  const finalAway = { ...finalHome, team_abbr: "NYK", wl: "L" };
  const resultLogs = [...logs, { ...logs[0], game_date: today, game_id: "official-today", updated_at: finalAt.toISOString() }];
  const settlement = { ...feed, previous: moved, odds: [], teamLogs: [...teamLogs, finalHome, finalAway], logs: resultLogs };
  const settled = buildNbaSnapshot(settlement, finalAt)?.board;
  assert(settled);
  assertEquals(reviewSlip(slip, settled, finalAt)[0].result, "push");
  const unrelated = buildNbaSnapshot({ ...settlement, logs: [...logs, { ...resultLogs.at(-1)!, game_id: "other" }] }, finalAt)?.board;
  assert(unrelated);
  assertEquals(reviewSlip(slip, unrelated, finalAt)[0].result, "pending");
});
