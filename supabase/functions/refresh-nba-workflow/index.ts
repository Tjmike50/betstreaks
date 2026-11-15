import { pipelineCron } from "../_shared/internalAuth.ts";
import { withPrivilegedPost } from "../_shared/privilegedPost.ts";
import { easternDate } from "../_shared/analyticsAssistant/contract.ts";
import {
  buildNbaSnapshot, feedDate, nbaOddsMarkets, type FeedGame, type FeedLog, type FeedOdds, type FeedScore, type FeedTeamLog,
} from "../_shared/nbaWorkflow/feed.ts";
import { verifiedSource } from "../_shared/nbaWorkflow/store.ts";

const pageSize = 500;
const maxRows = 30_000;

async function allRows<T>(read: (from: number, to: number) => PromiseLike<{
  data: unknown; error: unknown; count: number | null;
}>) {
  const rows: T[] = [];
  let expected: number | null = null;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error, count } = await read(offset, offset + pageSize - 1);
    if (error || !Array.isArray(data) || count === null || count > maxRows ||
      (expected !== null && count !== expected)) throw new Error("NBA input incomplete.");
    expected = count;
    if (data.length !== Math.min(pageSize, count - offset)) throw new Error("NBA input truncated.");
    rows.push(...data as T[]);
    if (rows.length === count) return rows;
  }
}

Deno.serve(withPrivilegedPost({ corsHeaders: {}, internal: pipelineCron }, async (req, { supabase }) => {
  if (Deno.env.get("NBA_WORKFLOW_FEED_ENABLED") !== "true") {
    return Response.json({ status: "disabled" }, { status: 503 });
  }

  const now = new Date();
  const today = easternDate(now);
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(18_000)]);
  const { data: previousRow, error } = await supabase.from("nba_workflow_snapshot")
    .select("payload").eq("id", true).abortSignal(signal).maybeSingle();
  if (error) return Response.json({ status: "snapshot_read_failed" }, { status: 503 });
  const previousSource = previousRow ? verifiedSource(previousRow.payload, now) : undefined;
  if (previousRow && !previousSource) return Response.json({ status: "previous_snapshot_invalid" }, { status: 503 });

  try {
    const [games, scores, odds, teamLogs] = await Promise.all([
      allRows<FeedGame>((from, to) => supabase.from("games_today")
        .select("id,game_date,home_team_abbr,away_team_abbr,verification_status,status,is_postponed,updated_at", { count: "exact" })
        .eq("sport", "NBA").eq("verification_status", "verified").gte("game_date", feedDate(now, 30))
        .lte("game_date", today).order("id").range(from, to).abortSignal(signal)),
      allRows<FeedScore>((from, to) => supabase.from("player_prop_scores")
        .select("player_id,player_name,team_abbr,opponent_abbr,game_date,stat_type,threshold,score_overall,scored_at", { count: "exact" })
        .eq("sport", "NBA").eq("game_date", today).order("id").range(from, to).abortSignal(signal)),
      allRows<FeedOdds>((from, to) => supabase.from("odds_cache")
        .select("event_id,home_team,away_team,commence_time,market_key,bookmaker_key,provider,fetched_at,odds_data", { count: "exact" })
        .eq("sport_key", "basketball_nba").in("market_key", Object.keys(nbaOddsMarkets))
        .gte("fetched_at", new Date(+now - 15 * 60_000).toISOString()).lte("fetched_at", now.toISOString())
        .order("id").range(from, to).abortSignal(signal)),
      allRows<FeedTeamLog>((from, to) => supabase.from("team_recent_games")
        .select("team_abbr,game_id,game_date,wl", { count: "exact" }).eq("sport", "NBA")
        .gte("game_date", feedDate(now, 45)).lte("game_date", today)
        .order("game_id").order("team_id").range(from, to).abortSignal(signal)),
    ]);
    const playerIds = [...new Set([...scores.map((row) => row.player_id),
      ...(previousSource?.board.markets.map((market) => market.player.id) ?? [])])];
    const logs: FeedLog[] = [];
    for (let index = 0; index < playerIds.length; index += 50) {
      const playerBatch = playerIds.slice(index, index + 50);
      logs.push(...await allRows<FeedLog>((from, to) => supabase.from("player_recent_games")
        .select("sport,player_id,game_id,game_date,matchup,wl,updated_at,pts,reb,ast,fg3m", { count: "exact" })
        .eq("sport", "NBA").in("player_id", playerBatch)
        .gte("game_date", feedDate(now, 45)).lte("game_date", today)
        .order("game_id").order("player_id").range(from, to).abortSignal(signal)));
    }
    const { data: retainedIds, error: retainedError } = previousSource
      ? await supabase.rpc("referenced_nba_workflow_markets", {
        p_market_ids: previousSource.board.markets.map((market) => market.id),
      }).abortSignal(signal)
      : { data: [], error: null };
    if (retainedError || !Array.isArray(retainedIds)) return Response.json({ status: "retention_read_failed" }, { status: 503 });
    const snapshot = buildNbaSnapshot({
      games, scores, odds, logs, teamLogs, previous: previousSource?.board, retainedIds: new Set<string>(retainedIds),
    }, now);
    if (!snapshot) return Response.json({ status: "verified_inputs_unavailable",
      rows: { games: games.length, scores: scores.length, odds: odds.length, logs: logs.length, teamLogs: teamLogs.length } }, { status: 503 });

    const { data, error: publishError } = await supabase.rpc("publish_nba_workflow_snapshot", { p_payload: snapshot })
      .abortSignal(signal);
    if (publishError) return Response.json({ status: "snapshot_write_failed" }, { status: 503 });
    if (data !== true) return Response.json({ status: "newer_snapshot_exists" }, { status: 409 });
    return Response.json({ status: "published", markets: snapshot.board.markets.length,
      playersWithCompleteLogs: snapshot.completePlayerIds.length, revision: snapshot.board.snapshot.revision });
  } catch {
    return Response.json({ status: "feed_read_failed" }, { status: 503 });
  }
}));
