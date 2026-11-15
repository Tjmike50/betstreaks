import { easternDate, isDate, isPlayerId, isRecord, metrics, type Metric } from "../analyticsAssistant/contract.ts";
import { normalizeName } from "../analyticsAssistant/questions.ts";
import type { Appearance } from "../analyticsAssistant/source.ts";
import { NBA_TEAM_ABBRS } from "../nbaTeams.ts";
import { maxBoardMarkets, shortText, validLine, validPrice, type Board, type Market, type Quote } from "./domain.ts";
import { verifiedSource } from "./store.ts";

export const nbaOddsMarkets = {
  player_points: "PTS", player_rebounds: "REB", player_assists: "AST", player_threes: "3PM",
} as const;

export type FeedGame = {
  id: string; game_date: string; home_team_abbr: string; away_team_abbr: string;
  verification_status: string; status: string | null; is_postponed: boolean; updated_at: string;
};
export type FeedScore = {
  player_id: number; player_name: string; team_abbr: string; opponent_abbr: string; game_date: string;
  stat_type: string; threshold: number; score_overall: number | null; scored_at: string;
};
export type FeedOdds = {
  event_id: string; home_team: string; away_team: string; commence_time: string;
  market_key: string; bookmaker_key: string; provider: string; fetched_at: string; odds_data: unknown;
};
export type FeedLog = Omit<Appearance, "eligibility"> & { matchup: string | null; wl: string | null };
export type SnapshotPayload = {
  board: Board; appearances: Appearance[]; completePlayerIds: number[]; coverageScope: "as_of";
};
export type FeedTeamLog = { team_abbr: string; game_id: string; game_date: string; wl: string | null };
type Feeds = {
  games: FeedGame[]; scores: FeedScore[]; odds: FeedOdds[]; logs: FeedLog[]; teamLogs: FeedTeamLog[];
  previous?: Board; retainedIds?: Set<string>;
};

const metricForStat: Record<string, Metric> = { pts: "PTS", reb: "REB", ast: "AST", fg3m: "3PM", "3pm": "3PM" };
const teams = new Set(Object.values(NBA_TEAM_ABBRS));
const providers = new Set(["the-odds-api", "odds-api-io"]);
const quoteMaxAge = 15 * 60_000;

export function feedDate(now: Date, daysAgo: number) {
  const civil = new Date(`${easternDate(now)}T00:00:00Z`);
  civil.setUTCDate(civil.getUTCDate() - daysAgo);
  return civil.toISOString().slice(0, 10);
}

function iso(value: string | null | undefined, asOf: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  const timestamp = new Date(value).toISOString();
  return timestamp <= asOf ? timestamp : undefined;
}

function lookup<T>(rows: T[], key: (row: T) => string) {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const entries = result.get(id);
    if (entries) entries.push(row);
    else result.set(id, [row]);
  }
  return result;
}

function exact<T>(rows: T[] | undefined): T | undefined {
  return rows?.length === 1 ? rows[0] : undefined;
}

const eventKey = (date: string, home: string, away: string) => JSON.stringify([date, home, away]);
const playerKey = (date: string, name: string, metric: Metric) => JSON.stringify([date, normalizeName(name), metric]);

function latestQuote(quotes: Quote[]) {
  const [first, ...others] = quotes.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return others.some((quote) => quote.observedAt === first.observedAt &&
    (quote.price !== first.price || quote.line !== first.line)) ? undefined : first;
}

export function buildNbaSnapshot(feed: Feeds, now: Date): SnapshotPayload | undefined {
  const asOf = now.toISOString();
  const today = easternDate(now);
  const priorDay = easternDate(now, true);
  const finalTeamLogs = feed.teamLogs.filter((row) => teams.has(row.team_abbr) &&
    shortText(row.game_id) && isDate(row.game_date) && row.game_date <= today && (row.wl === "W" || row.wl === "L"));
  const historicalTeamLogs = finalTeamLogs.filter((row) => row.game_date <= priorDay);
  const coverageThrough = historicalTeamLogs.reduce((max, row) => row.game_date > max ? row.game_date : max, "");
  if (!coverageThrough || coverageThrough < feedDate(now, 3)) return;
  const games = feed.games.filter((game) => game.verification_status === "verified" && shortText(game.id, 60) &&
    isDate(game.game_date) && teams.has(game.home_team_abbr) && teams.has(game.away_team_abbr));
  const gamesByMatch = lookup(games, (game) => eventKey(game.game_date, game.home_team_abbr, game.away_team_abbr));
  const gamesById = lookup(games, (game) => game.id);
  const scoresByPlayer = lookup(feed.scores.filter((row) =>
    typeof row.stat_type === "string" && Object.hasOwn(metricForStat, row.stat_type.toLowerCase()) &&
    shortText(row.player_name) && isPlayerId(row.player_id)
  ), (row) => playerKey(row.game_date, row.player_name, metricForStat[row.stat_type.toLowerCase()]));
  const markets = new Map<string, { market: Market; offers: Quote[]; providerEvents: Set<string> }>();
  const previous = new Map(feed.previous?.markets.map((market) => [market.id, market]));

  for (const row of feed.odds) {
    const fetchedAt = iso(row.fetched_at, asOf);
    const commenceTime = row.commence_time && Date.parse(row.commence_time);
    if (!fetchedAt || +now - Date.parse(fetchedAt) > quoteMaxAge || !commenceTime || commenceTime <= +now ||
      !providers.has(row.provider) || !shortText(row.event_id) || !shortText(row.bookmaker_key) ||
      !Array.isArray(row.odds_data) || !Object.hasOwn(nbaOddsMarkets, row.market_key)) continue;
    const game = exact(gamesByMatch.get(eventKey(easternDate(new Date(commenceTime)),
      NBA_TEAM_ABBRS[row.home_team], NBA_TEAM_ABBRS[row.away_team])));
    if (!game || game.game_date !== today || game.is_postponed || /^final/i.test(game.status ?? "")) continue;
    const metric = nbaOddsMarkets[row.market_key as keyof typeof nbaOddsMarkets];
    const matchup = `${game.away_team_abbr} @ ${game.home_team_abbr}`;

    for (const outcome of row.odds_data) {
      if (!isRecord(outcome) || !shortText(outcome.description) || !validPrice(outcome.price) || !validLine(outcome.point) ||
        (outcome.name !== "Over" && outcome.name !== "Under")) continue;
      const line = outcome.point;
      const matchingScores = (scoresByPlayer.get(playerKey(today, outcome.description, metric)) ?? []).filter((score) =>
        (score.team_abbr === game.home_team_abbr && score.opponent_abbr === game.away_team_abbr) ||
        (score.team_abbr === game.away_team_abbr && score.opponent_abbr === game.home_team_abbr));
      if (new Set(matchingScores.map((score) => score.player_id)).size !== 1) continue;
      const player = matchingScores[0];
      const side = outcome.name === "Over" ? "over" : "under";
      const id = `nba:${game.id}:${player.player_id}:${metric}:${side}`;
      const matchingScore = side === "over" ? exact(matchingScores.filter((score) => score.threshold === line)) : undefined;
      const scoredAt = iso(matchingScore?.scored_at, asOf);
      const scoreValue = matchingScore?.score_overall;
      const score = scoredAt && typeof scoreValue === "number" && scoreValue >= 0 && scoreValue <= 100
        ? { value: scoreValue, factors: [], missing: ["Verified score breakdown"], asOf: scoredAt }
        : null;
      const pending = markets.get(id) ?? {
        market: { id, eventId: game.id, date: today, matchup, metric, side, score,
          player: { id: player.player_id, name: player.player_name, team: player.team_abbr, sport: "NBA" },
          availability: null, result: null, quotes: [], previousQuotes: [] },
        offers: [],
        providerEvents: new Set<string>(),
      };
      pending.providerEvents.add(`${row.provider}:${row.event_id}`);
      pending.offers.push({ book: row.bookmaker_key, line, price: outcome.price, observedAt: fetchedAt, main: true });
      if (pending.market.score?.value !== score?.value) pending.market.score = null;
      markets.set(id, pending);
    }
  }

  const active: Market[] = [];
  for (const { market, offers, providerEvents } of markets.values()) {
    // Require one source event and one main line per book. Conflicting quotes are excluded.
    if (providerEvents.size !== 1) continue;
    const quotes: Quote[] = [];
    for (const bookQuotes of lookup(offers, (quote) => quote.book).values()) {
      const quote = latestQuote(bookQuotes);
      if (quote) quotes.push(quote);
    }
    if (!quotes.length) continue;
    market.quotes = quotes.sort((a, b) => a.book.localeCompare(b.book));
    const old = previous.get(market.id);
    market.previousQuotes = old
      ? old.quotes.filter((quote) => !quotes.some((current) =>
        current.book === quote.book && current.line === quote.line && current.price === quote.price))
      : [];
    if (!market.previousQuotes.length) market.previousQuotes = old?.previousQuotes ?? [];
    active.push(market);
  }

  if (!active.length && !previous.size) return;
  const marketIds = new Set(active.map((market) => market.id));
  const offeredAfter = feedDate(now, 30);
  const logsByPlayer = lookup(feed.logs.filter((row) => row.sport === "NBA" && isPlayerId(row.player_id) &&
    shortText(row.game_id) && isDate(row.game_date) && iso(row.updated_at, asOf) &&
    (row.wl === "W" || row.wl === "L")), (row) => String(row.player_id));
  const retained: Market[] = [];
  const finalGamesByDate = lookup(finalTeamLogs, (row) => row.game_date);
  for (const old of previous.values()) {
    if (old.date < offeredAfter || marketIds.has(old.id) || (old.date < priorDay && !feed.retainedIds?.has(old.id))) continue;
    const game = exact(gamesById.get(old.eventId));
    let result = old.result;
    if (game) {
      const observedAt = iso(game.updated_at, asOf);
      if (observedAt && game.is_postponed && result?.state !== "final") result = { state: "postponed", value: null, observedAt };
      const dateLogs = finalGamesByDate.get(game.game_date) ?? [];
      const homeLog = exact(dateLogs.filter((row) => row.team_abbr === game.home_team_abbr));
      const awayLog = exact(dateLogs.filter((row) => row.team_abbr === game.away_team_abbr));
      if (observedAt && homeLog && awayLog && homeLog.game_id === awayLog.game_id && homeLog.wl !== awayLog.wl &&
        [game.home_team_abbr, game.away_team_abbr].includes(old.player.team)) {
        const log = exact(logsByPlayer.get(String(old.player.id))?.filter((row) =>
          row.game_date === game.game_date && row.game_id === homeLog.game_id));
        const value = log?.[metrics[old.metric].column];
        if (log && typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
          const loggedAt = iso(log.updated_at, asOf)!;
          const settledAt = loggedAt > observedAt ? loggedAt : observedAt;
          if (!result || result.state !== "final" || settledAt > result.observedAt) {
            result = { state: "final", value, observedAt: settledAt };
          }
        }
      }
    }
    // Removing the current quote prevents saving a market that disappeared from the provider.
    retained.push({ ...old, quotes: [], previousQuotes: old.quotes.length ? old.quotes : old.previousQuotes, result });
  }

  const assembled = [...active, ...retained];
  if (assembled.length > maxBoardMarkets || !assembled.length) return;
  const ids = new Set(assembled.map((market) => market.player.id));
  const appearances: Appearance[] = [];
  const completePlayerIds: number[] = [];
  const playerTeams = lookup(assembled, (market) => String(market.player.id));
  const finalGamesByTeam = lookup(historicalTeamLogs, (row) => row.team_abbr);
  for (const id of ids) {
    const rows = (logsByPlayer.get(String(id)) ?? []).filter((row) => row.game_date <= coverageThrough);
    const playerTeam = playerTeams.get(String(id))![0].player.team;
    const mostRecent = rows.slice().sort((a, b) => b.game_date.localeCompare(a.game_date)).slice(0, 10);
    const cutoff = mostRecent.at(-1)?.game_date;
    const teamGames = (finalGamesByTeam.get(playerTeam) ?? []).filter((row) => cutoff && row.game_date >= cutoff);
    const teamKeys = new Set(teamGames.map((row) => JSON.stringify([row.game_id, row.game_date])));
    const appearanceKeys = new Set(mostRecent.map((row) => JSON.stringify([row.game_id, row.game_date])));
    if (teamKeys.size === 10 && appearanceKeys.size === 10 && mostRecent.every((row) =>
      row.matchup?.startsWith(`${playerTeam} `) && teamKeys.has(JSON.stringify([row.game_id, row.game_date])))) {
      completePlayerIds.push(id);
    }
    for (const row of rows) {
      appearances.push({
        sport: "NBA", player_id: id, game_id: row.game_id, game_date: row.game_date, updated_at: iso(row.updated_at, asOf)!,
        pts: row.pts, reb: row.reb, ast: row.ast, fg3m: row.fg3m, eligibility: "final",
      });
    }
  }
  const latestQuoteAt = active.flatMap((market) => market.quotes).map((quote) => quote.observedAt).sort().at(-1)
    ?? feed.previous?.snapshot.fetchedAt;
  if (!latestQuoteAt) return;
  const payload: SnapshotPayload = {
    board: { asOf, markets: assembled, snapshot: { mode: "verified", dataset: "BetStreaks NBA feeds",
      source: "NBA Stats, verified schedule and sportsbook cache", revision: `nba:${asOf}`, snapshotAt: asOf,
      fetchedAt: latestQuoteAt, coverageThrough } },
    appearances,
    completePlayerIds,
    coverageScope: "as_of",
  };
  return verifiedSource(payload, now) ? payload : undefined;
}
