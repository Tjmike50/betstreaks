import type { Player, Snapshot } from "./contract.ts";
import type { Appearance, GameLogSource } from "./source.ts";

export const fixtureSnapshot: Snapshot = {
  dataset: "BetStreaks NBA Synthetic Game Logs",
  revision: "nba-fixtures-v1",
  source: "Hand-authored BetStreaks fixtures",
  mode: "fixture",
  snapshotAt: "2026-11-10T12:00:00.000Z",
  coverageThrough: "2026-11-10",
  fetchedAt: null,
};

const players: readonly Player[] = [
  { id: 1001, name: "Avery Stone", team: "BOS", sport: "NBA" },
  { id: 1002, name: "Jordan Reed", team: "BOS", sport: "NBA" },
  { id: 1003, name: "Jordan Reed", team: "NYK", sport: "NBA" },
  { id: 1004, name: "Casey Lane", team: "CHI", sport: "NBA" },
  { id: 1005, name: "Riley Moss", team: "DEN", sport: "NBA" },
  { id: 1006, name: "Taylor Finch", team: "PHX", sport: "NBA" },
];

const dates = [
  "2026-11-09", "2026-11-07", "2026-11-05", "2026-11-03", "2026-11-01",
  "2026-10-30", "2026-10-28", "2026-10-26", "2026-10-24", "2026-10-22",
];
type Values = [number | null, number, number, number];
function rows(id: number, games: Values[]): Appearance[] {
  return games.map(([pts, reb, ast, fg3m], index) => ({
    sport: "NBA",
    player_id: id,
    game_id: `fixture-${id}-${index + 1}`,
    game_date: dates[index],
    pts, reb, ast, fg3m,
    updated_at: fixtureSnapshot.snapshotAt,
    eligibility: "final",
  }));
}

const avery = rows(1001, [
  [10, 4, 1, 0], [20, 8, 3, 2], [30, 5, 5, 4], [20, 6, 7, 2], [15, 7, 9, 1],
  [25, 10, 6, 3], [12, 2, 4, 1], [24, 8, 3, 2], [16, 5, 2, 0], [28, 5, 0, 5],
]);
const taylor = rows(1006, [[9, 3, 2, 1], [21, 6, 5, 1], [17, 3, 2, 1],
  [23, 3, 2, 1], [10, 3, 2, 1], [99, 3, 2, 1]]);
// Two rows on the cutoff date. The lexically larger ID makes the window.
taylor[5].game_date = taylor[4].game_date;
taylor[5].game_id = "fixture-1006-0";

const fixtureRows: readonly Appearance[] = [
  ...avery,
  { ...avery[0] }, // Duplicate source row.
  { ...avery[0], sport: "WNBA", pts: 99 }, // Cross-league ID collision.
  { ...avery[0], game_id: "fixture-dnp", game_date: "2026-11-10", eligibility: "dnp", pts: 0 },
  { ...avery[0], game_id: "fixture-scheduled", game_date: "2026-11-10", eligibility: "scheduled" },
  ...rows(1002, [[12, 2, 5, 1], [15, 5, 5, 2], [18, 4, 5, 2], [21, 5, 5, 3], [24, 7, 5, 4]]),
  ...rows(1003, [[4, 8, 2, 0], [8, 8, 3, 1], [12, 8, 4, 2], [16, 8, 5, 3], [20, 8, 6, 4]]),
  ...rows(1004, [[4, 5, 5, 1], [null, 5, 5, 1], [8, 5, 5, 1], [12, 5, 5, 1], [16, 5, 5, 1], [99, 5, 5, 1]]),
  ...rows(1005, [[8, 3, 2, 1], [12, 3, 2, 1], [15, 3, 2, 1], [17, 3, 2, 1]]),
  ...taylor,
];

export const fixtureSource: GameLogSource = {
  snapshot: fixtureSnapshot,
  players,
  readGames(query, signal) {
    signal.throwIfAborted();
    return Promise.resolve({
      complete: true,
      rows: fixtureRows.filter((row) => row.sport === query.sport &&
        row.player_id === query.playerId && row.game_date <= query.asOf),
    });
  },
};
