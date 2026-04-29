import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ===== TYPES =====

interface NormalizedOutcome {
  name: string;
  price: number;
  point?: number;
  description?: string;
}

interface NormalizedOdds {
  provider: string;
  sportKey: string;
  eventId: string;
  marketKey: string;
  bookmakerKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  outcomes: NormalizedOutcome[];
  fetchedAt: string;
}

type ProviderFailureInfo = {
  provider: string;
  status: number | null;
  errorCode: string | null;
  message: string;
};

// ===== PROVIDER 1: The Odds API =====

async function getOddsFromTheOddsApi(
  apiKey: string,
  sport: string,
  market: string,
  eventId?: string,
  bookmaker?: string,
): Promise<NormalizedOdds[]> {
  const base = "https://api.the-odds-api.com/v4";
  const bookmakers = bookmaker || "draftkings,fanduel,betmgm,pointsbetus";
  const now = new Date().toISOString();

  // The Odds API requires player-prop markets (NBA `player_*`, MLB `batter_*` /
  // `pitcher_*`) to be fetched via the per-event endpoint. Game-level markets
  // (h2h, spreads, totals) use the league endpoint. Detect by checking whether
  // ANY market in the comma-joined list looks like a player prop.
  const marketList = market.split(",").map((m) => m.trim()).filter(Boolean);
  const isPlayerProp = marketList.some(
    (m) =>
      m.startsWith("player_") ||
      m.startsWith("batter_") ||
      m.startsWith("pitcher_"),
  );
  let url: string;
  if (eventId && isPlayerProp) {
    url = `${base}/sports/${sport}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${market}&oddsFormat=american&bookmakers=${bookmakers}`;
  } else {
    url = `${base}/sports/${sport}/odds/?apiKey=${apiKey}&regions=us&markets=${market}&oddsFormat=american&bookmakers=${bookmakers}`;
  }

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let parsedBody: Record<string, unknown> | null = null;
    try {
      parsedBody = body ? JSON.parse(body) : null;
    } catch {
      parsedBody = null;
    }
    const errorCode = typeof parsedBody?.error_code === "string" ? parsedBody.error_code : null;
    const errorMessage =
      typeof parsedBody?.message === "string"
        ? parsedBody.message
        : typeof parsedBody?.error === "string"
        ? parsedBody.error
        : body.slice(0, 400);
    const err = new Error(`the-odds-api ${res.status}: ${errorMessage}`);
    (err as Error & {
      provider?: string;
      status?: number;
      errorCode?: string | null;
      rawBodySample?: string;
    }).provider = "the-odds-api";
    (err as Error & { status?: number }).status = res.status;
    (err as Error & { errorCode?: string | null }).errorCode = errorCode;
    (err as Error & { rawBodySample?: string }).rawBodySample = body.slice(0, 400);
    throw err;
  }

  const raw = await res.json();
  const results: NormalizedOdds[] = [];
  const events = Array.isArray(raw) ? raw : [raw];

  for (const event of events) {
    for (const bm of event.bookmakers || []) {
      for (const mkt of bm.markets || []) {
        const outcomes: NormalizedOutcome[] = (mkt.outcomes || []).map((o: any) => ({
          name: o.name,
          price: o.price,
          ...(o.point != null ? { point: o.point } : {}),
          ...(o.description ? { description: o.description } : {}),
        }));

        results.push({
          provider: "the-odds-api",
          sportKey: sport,
          eventId: event.id,
          marketKey: mkt.key,
          bookmakerKey: bm.key,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          commenceTime: event.commence_time,
          outcomes,
          fetchedAt: now,
        });
      }
    }
  }

  return results;
}

// ===== PROVIDER 2: Odds-API.io (V3) =====

// Map our internal market keys to Odds-API.io market display names
const ODDS_API_IO_MARKET_MAP: Record<string, string> = {
  h2h: "ML",
  spreads: "Spread",
  totals: "Totals",
  player_points: "Player Props",
  player_rebounds: "Player Props",
  player_assists: "Player Props",
  player_threes: "Player Props",
  player_blocks: "Player Props",
  player_steals: "Player Props",
};

const ODDS_API_IO_MARKET_ALIASES: Record<string, string[]> = {
  h2h: ["ml", "moneyline"],
  spreads: ["spread", "spreads"],
  totals: ["total", "totals"],
  player_points: ["player props points", "player points", "points", "pts"],
  player_rebounds: ["player props rebounds", "player rebounds", "rebounds", "reb"],
  player_assists: ["player props assists", "player assists", "assists", "ast"],
  player_threes: ["player props threes", "player threes", "three pointers", "3-pointers", "3 pointers", "triples"],
  player_blocks: ["player props blocks", "player blocks", "blocks", "blk"],
  player_steals: ["player props steals", "player steals", "steals", "stl"],
};

function normalizeMarketText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferOddsApiIoInternalMarketKey(
  requestedMarkets: string[],
  marketRow: Record<string, unknown>,
): string | null {
  const searchText = [
    marketRow.name,
    marketRow.label,
    marketRow.header,
    marketRow.market,
    marketRow.type,
    marketRow.key,
  ].map(normalizeMarketText).filter(Boolean).join(" | ");

  if (!searchText) {
    return requestedMarkets.length === 1 ? requestedMarkets[0] : null;
  }

  for (const requestedMarket of requestedMarkets) {
    const aliases = ODDS_API_IO_MARKET_ALIASES[requestedMarket] ?? [normalizeMarketText(requestedMarket)];
    if (aliases.some((alias) => alias && searchText.includes(alias))) {
      return requestedMarket;
    }
  }

  const hasGenericPlayerProps = searchText.includes("player props");
  if (hasGenericPlayerProps && requestedMarkets.length === 1 && requestedMarkets[0].startsWith("player_")) {
    return requestedMarkets[0];
  }

  return null;
}

// Map bookmaker display names to slug keys
function bmSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function getOddsFromOddsApiIo(
  apiKey: string,
  sport: string,
  market: string,
  eventId?: string,
  _bookmaker?: string,
): Promise<NormalizedOdds[]> {
  const baseUrl = "https://api.odds-api.io/v3";
  const now = new Date().toISOString();
  const results: NormalizedOdds[] = [];
  const requestedMarkets = market.split(",").map((m) => m.trim()).filter(Boolean);

  const leagueBySport: Record<string, { sport: string; league: string } | null> = {
    basketball_nba: { sport: "basketball", league: "usa-nba" },
    basketball_wnba: { sport: "basketball", league: "usa-wnba" },
  };
  const leagueConfig = leagueBySport[sport] ?? null;
  if (!leagueConfig) {
    console.warn(`[get-odds] Odds-API.io backup not configured for sport=${sport}`);
    return results;
  }

  // Step 1: Get event IDs (unless one was provided)
  let eventIds: number[] = [];

  if (eventId) {
    eventIds = [Number(eventId)];
  } else {
    const eventsUrl =
      `${baseUrl}/events?apiKey=${apiKey}&sport=${leagueConfig.sport}&league=${leagueConfig.league}`;
    console.log(`[get-odds] Odds-API.io fetching events: ${eventsUrl.replace(apiKey, "***")}`);
    const eventsRes = await fetch(eventsUrl);
    if (!eventsRes.ok) {
      const body = await eventsRes.text().catch(() => "");
      const err = new Error(`odds-api-io events ${eventsRes.status}: ${body.slice(0, 400)}`);
      (err as Error & { provider?: string; status?: number }).provider = "odds-api-io";
      (err as Error & { status?: number }).status = eventsRes.status;
      throw err;
    }
    const eventsData = await eventsRes.json();
    const eventsList = Array.isArray(eventsData) ? eventsData : (eventsData.data || []);
    eventIds = eventsList.map((e: any) => e.id).filter(Boolean);
    console.log(`[get-odds] Odds-API.io found ${eventIds.length} pending events`);
  }

  if (eventIds.length === 0) return results;

  // Step 2: Fetch odds for each event (batch up to 10 concurrent)
  const bookmakerFilter = "DraftKings,FanDuel,BetMGM";

  const fetchOddsForEvent = async (eid: number) => {
    const oddsUrl = `${baseUrl}/odds?apiKey=${apiKey}&eventId=${eid}&bookmakers=${encodeURIComponent(bookmakerFilter)}`;
    const oddsRes = await fetch(oddsUrl);
    if (!oddsRes.ok) {
      console.warn(`[get-odds] Odds-API.io odds failed for event ${eid}: ${oddsRes.status}`);
      return;
    }
    const eventData = await oddsRes.json();

    const homeTeam = eventData.home || "";
    const awayTeam = eventData.away || "";
    const commenceTime = eventData.date || "";
    const eventIdStr = String(eventData.id || eid);

    // bookmakers is an object keyed by display name
    const bookmakers = eventData.bookmakers || {};

    for (const [bmName, markets] of Object.entries(bookmakers)) {
      if (!Array.isArray(markets)) continue;

      for (const mkt of markets as any[]) {
        const internalMarketKey = inferOddsApiIoInternalMarketKey(requestedMarkets, mkt as Record<string, unknown>);
        if (!internalMarketKey) continue;

        const oddsEntries = mkt.odds || [];
        const outcomes: NormalizedOutcome[] = [];

        for (const odd of oddsEntries) {
          const targetMarket = ODDS_API_IO_MARKET_MAP[internalMarketKey] || internalMarketKey;
          if (targetMarket === "ML") {
            // Moneyline: { home: "1.5", away: "2.3" }
            if (odd.home != null) {
              outcomes.push({ name: homeTeam, price: Number(odd.home) });
            }
            if (odd.away != null) {
              outcomes.push({ name: awayTeam, price: Number(odd.away) });
            }
          } else if (targetMarket === "Spread") {
            // Spread: { home: "-3.5", away: "3.5", hdp: -3.5 }
            if (odd.home != null) {
              outcomes.push({ name: homeTeam, price: Number(odd.home), point: Number(odd.hdp || 0) });
            }
            if (odd.away != null) {
              outcomes.push({ name: awayTeam, price: Number(odd.away), point: -(Number(odd.hdp || 0)) });
            }
          } else if (targetMarket === "Totals") {
            // Totals: { over: "1.9", under: "1.9", hdp: 220.5 }
            if (odd.over != null) {
              outcomes.push({ name: "Over", price: Number(odd.over), point: Number(odd.hdp || 0) });
            }
            if (odd.under != null) {
              outcomes.push({ name: "Under", price: Number(odd.under), point: Number(odd.hdp || 0) });
            }
          } else if (targetMarket === "Player Props") {
            // Player Props: { over: "-110", under: "-110", hdp: 24.5, label: "LeBron James" }
            const playerName = odd.label || "Unknown";
            if (odd.over != null) {
              outcomes.push({
                name: "Over",
                price: Number(odd.over),
                point: Number(odd.hdp || 0),
                description: playerName,
              });
            }
            if (odd.under != null) {
              outcomes.push({
                name: "Under",
                price: Number(odd.under),
                point: Number(odd.hdp || 0),
                description: playerName,
              });
            }
          }
        }

        if (outcomes.length > 0) {
          results.push({
            provider: "odds-api-io",
            sportKey: sport,
            eventId: eventIdStr,
            marketKey: internalMarketKey,
            bookmakerKey: bmSlug(bmName),
            homeTeam,
            awayTeam,
            commenceTime,
            outcomes,
            fetchedAt: now,
          });
        }
      }
    }
  };

  // Fetch in batches of 10
  for (let i = 0; i < eventIds.length; i += 10) {
    const batch = eventIds.slice(i, i + 10);
    await Promise.allSettled(batch.map(fetchOddsForEvent));
  }

  return results;
}

// ===== CACHE LOGIC =====

async function getCachedOdds(
  supabase: any,
  sport: string,
  market: string,
  eventId?: string,
  bookmaker?: string,
): Promise<{ fresh: NormalizedOdds[] | null; stale: NormalizedOdds[] | null }> {
  let query = supabase
    .from("odds_cache")
    .select("*")
    .eq("sport_key", sport)
    .eq("market_key", market);

  if (eventId) query = query.eq("event_id", eventId);
  if (bookmaker) query = query.eq("bookmaker_key", bookmaker);

  const { data, error } = await query;
  if (error || !data || data.length === 0) return { fresh: null, stale: null };

  const now = new Date();
  const fresh: NormalizedOdds[] = [];
  const stale: NormalizedOdds[] = [];

  for (const row of data) {
    const entry: NormalizedOdds = {
      provider: row.provider,
      sportKey: row.sport_key,
      eventId: row.event_id,
      marketKey: row.market_key,
      bookmakerKey: row.bookmaker_key,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      commenceTime: row.commence_time || "",
      outcomes: row.odds_data || [],
      fetchedAt: row.fetched_at,
    };

    if (new Date(row.expires_at) > now) {
      fresh.push(entry);
    } else {
      stale.push(entry);
    }
  }

  return {
    fresh: fresh.length > 0 ? fresh : null,
    stale: stale.length > 0 ? stale : null,
  };
}

async function upsertCache(
  supabase: any,
  odds: NormalizedOdds[],
  ttlSeconds: number,
): Promise<void> {
  if (odds.length === 0) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const rows = odds.map((o) => ({
    sport_key: o.sportKey,
    event_id: o.eventId,
    market_key: o.marketKey,
    bookmaker_key: o.bookmakerKey,
    home_team: o.homeTeam,
    away_team: o.awayTeam,
    commence_time: o.commenceTime || null,
    odds_data: o.outcomes,
    provider: o.provider,
    fetched_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  }));

  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await supabase
      .from("odds_cache")
      .upsert(batch, { onConflict: "sport_key,event_id,market_key,bookmaker_key" });
    if (error) console.error("Cache upsert error:", error);
  }
}

async function cleanupExpiredCache(supabase: any): Promise<void> {
  const { error } = await supabase
    .from("odds_cache")
    .delete()
    .lt("expires_at", new Date(Date.now() - 3600_000).toISOString());
  if (error) console.error("Cache cleanup error:", error);
}

// ===== MAIN HANDLER =====

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const sport = body.sport || "basketball_nba";
    const market = body.market || "h2h";
    const eventId = body.eventId || undefined;
    const bookmaker = body.bookmaker || undefined;
    // Tightened TTLs: 90s for game-level, 45s for player props
    const ttl = body.ttl || (market.startsWith("player_") ? 45 : 90);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Step 1: Check cache
    const cached = await getCachedOdds(supabase, sport, market, eventId, bookmaker);

    if (cached.fresh) {
      console.log(`[get-odds] Cache HIT (fresh) — ${cached.fresh.length} entries`);
      return new Response(JSON.stringify({
        ok: true,
        data: cached.fresh,
        meta: {
          provider: cached.fresh[0]?.provider || "cache",
          fetchedAt: cached.fresh[0]?.fetchedAt || new Date().toISOString(),
          isStale: false,
          fallbackUsed: false,
          fromCache: true,
          count: cached.fresh.length,
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 2: Try primary provider
    let odds: NormalizedOdds[] | null = null;
    let provider = "none";
    let fallbackUsed = false;
    let primaryFailure: ProviderFailureInfo | null = null;
    let backupFailure: ProviderFailureInfo | null = null;

    const PRIMARY_KEY = Deno.env.get("ODDS_API_KEY");
    if (PRIMARY_KEY) {
      try {
        console.log(`[get-odds] Fetching from primary (the-odds-api)...`);
        odds = await getOddsFromTheOddsApi(PRIMARY_KEY, sport, market, eventId, bookmaker);
        provider = "the-odds-api";
        console.log(`[get-odds] Primary returned ${odds.length} entries`);
      } catch (e) {
        console.error(`[get-odds] Primary failed:`, e);
        primaryFailure = {
          provider: "the-odds-api",
          status: typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : null,
          errorCode: typeof (e as { errorCode?: unknown })?.errorCode === "string"
            ? (e as { errorCode: string }).errorCode
            : null,
          message: e instanceof Error ? e.message : String(e),
        };
      }
    }

    // Step 3: Try backup provider if primary failed
    if (!odds || odds.length === 0) {
      const BACKUP_KEY = Deno.env.get("ODDS_API_IO_KEY");
      if (BACKUP_KEY) {
        try {
          console.log(`[get-odds] Fetching from backup (odds-api-io)...`);
          if (market.includes(",")) {
            const segments = market.split(",").map((m: string) => m.trim()).filter(Boolean);
            const settled = await Promise.allSettled(
              segments.map((segment) => getOddsFromOddsApiIo(BACKUP_KEY, sport, segment, eventId, bookmaker)),
            );
            odds = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
          } else {
            odds = await getOddsFromOddsApiIo(BACKUP_KEY, sport, market, eventId, bookmaker);
          }
          provider = "odds-api-io";
          fallbackUsed = true;
          console.log(`[get-odds] Backup returned ${odds.length} entries`);
        } catch (e) {
          console.error(`[get-odds] Backup failed:`, e);
          backupFailure = {
            provider: "odds-api-io",
            status: typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : null,
            errorCode: typeof (e as { errorCode?: unknown })?.errorCode === "string"
              ? (e as { errorCode: string }).errorCode
              : null,
            message: e instanceof Error ? e.message : String(e),
          };
        }
      }
    }

    // Step 4: If we got fresh odds, cache them and return
    if (odds && odds.length > 0) {
      // Cache + cleanup in background
      upsertCache(supabase, odds, ttl)
        .then(() => cleanupExpiredCache(supabase))
        .catch((e) => console.error("[get-odds] Cache write/cleanup error:", e));

      return new Response(JSON.stringify({
        ok: true,
        data: odds,
        meta: {
          provider,
          fetchedAt: new Date().toISOString(),
          isStale: false,
          fallbackUsed,
          fromCache: false,
          count: odds.length,
          quotaExhausted: primaryFailure?.errorCode === "OUT_OF_USAGE_CREDITS",
          providerUnavailableReason:
            primaryFailure?.errorCode === "OUT_OF_USAGE_CREDITS"
              ? "OUT_OF_USAGE_CREDITS"
              : null,
          primaryError: primaryFailure,
          backupError: backupFailure,
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 5: Both providers failed — return stale cache if available
    if (cached.stale) {
      console.log(`[get-odds] Both providers failed — returning stale cache (${cached.stale.length} entries)`);
      return new Response(JSON.stringify({
        ok: true,
        data: cached.stale,
        meta: {
          provider: cached.stale[0]?.provider || "cache",
          fetchedAt: cached.stale[0]?.fetchedAt || new Date().toISOString(),
          isStale: true,
          fallbackUsed: true,
          fromCache: true,
          count: cached.stale.length,
          quotaExhausted: primaryFailure?.errorCode === "OUT_OF_USAGE_CREDITS",
          providerUnavailableReason:
            primaryFailure?.errorCode === "OUT_OF_USAGE_CREDITS"
              ? "OUT_OF_USAGE_CREDITS"
              : null,
          primaryError: primaryFailure,
          backupError: backupFailure,
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 6: Nothing available
    console.warn("[get-odds] No odds available from any source");
    return new Response(JSON.stringify({
      ok: false,
      data: [],
      error_code: primaryFailure?.errorCode ?? null,
      meta: {
        provider: "none",
        fetchedAt: new Date().toISOString(),
        isStale: false,
        fallbackUsed: true,
        fromCache: false,
        count: 0,
        quotaExhausted: primaryFailure?.errorCode === "OUT_OF_USAGE_CREDITS",
        providerUnavailableReason:
          primaryFailure?.errorCode === "OUT_OF_USAGE_CREDITS"
            ? "OUT_OF_USAGE_CREDITS"
            : null,
        primaryError: primaryFailure,
        backupError: backupFailure,
      },
      error:
        primaryFailure?.errorCode === "OUT_OF_USAGE_CREDITS"
          ? "The Odds API quota is exhausted."
          : "No odds available from any provider or cache",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[get-odds] Error:", e);
    return new Response(JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
