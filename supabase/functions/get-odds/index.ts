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

// ===== PROVIDER ADAPTERS =====

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

  let url: string;
  if (eventId && market.startsWith("player_")) {
    // Event-specific player props
    url = `${base}/sports/${sport}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${market}&oddsFormat=american&bookmakers=${bookmakers}`;
  } else {
    // Game-level odds
    url = `${base}/sports/${sport}/odds/?apiKey=${apiKey}&regions=us&markets=${market}&oddsFormat=american&bookmakers=${bookmakers}`;
  }

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`the-odds-api ${res.status}: ${body}`);
  }

  const raw = await res.json();
  const results: NormalizedOdds[] = [];

  // Handle single-event response (has bookmakers directly) vs list
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

async function getOddsFromOddsApiIo(
  apiKey: string,
  sport: string,
  market: string,
  _eventId?: string,
  _bookmaker?: string,
): Promise<NormalizedOdds[]> {
  // Odds-API.io uses a slightly different URL structure
  // Map sport keys: basketball_nba -> nba
  const sportMap: Record<string, string> = {
    basketball_nba: "basketball/nba",
  };
  const mappedSport = sportMap[sport] || sport;
  const now = new Date().toISOString();

  // Odds-API.io endpoint format
  const url = `https://api.odds-api.io/v1/odds?sport=${mappedSport}&market=${market}&apiKey=${apiKey}&format=american`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`odds-api-io ${res.status}: ${body}`);
  }

  const raw = await res.json();
  const results: NormalizedOdds[] = [];

  // Normalize the response — adapt to actual Odds-API.io response shape
  const events = raw.data || raw.events || (Array.isArray(raw) ? raw : []);

  for (const event of events) {
    const eventId = event.id || event.event_id || `${event.home_team}-${event.away_team}`;
    const bookmakers = event.bookmakers || event.sportsbooks || [];

    for (const bm of bookmakers) {
      const bmKey = bm.key || bm.name || "unknown";
      const markets = bm.markets || [];

      for (const mkt of markets) {
        const mktKey = mkt.key || mkt.name || market;
        const outcomes: NormalizedOutcome[] = (mkt.outcomes || []).map((o: any) => ({
          name: o.name || o.label,
          price: Number(o.price || o.odds),
          ...(o.point != null ? { point: Number(o.point) } : {}),
          ...(o.description ? { description: o.description } : {}),
        }));

        results.push({
          provider: "odds-api-io",
          sportKey: sport,
          eventId,
          marketKey: mktKey,
          bookmakerKey: bmKey,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          commenceTime: event.commence_time || event.start_time || "",
          outcomes,
          fetchedAt: now,
        });
      }
    }
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

  // Batch upsert in chunks of 100
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await supabase
      .from("odds_cache")
      .upsert(batch, { onConflict: "sport_key,event_id,market_key,bookmaker_key" });
    if (error) console.error("Cache upsert error:", error);
  }
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
    const ttl = body.ttl || (market.startsWith("player_") ? 120 : 300); // 2 min props, 5 min games

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

    const PRIMARY_KEY = Deno.env.get("ODDS_API_KEY");
    if (PRIMARY_KEY) {
      try {
        console.log(`[get-odds] Fetching from primary (the-odds-api)...`);
        odds = await getOddsFromTheOddsApi(PRIMARY_KEY, sport, market, eventId, bookmaker);
        provider = "the-odds-api";
        console.log(`[get-odds] Primary returned ${odds.length} entries`);
      } catch (e) {
        console.error(`[get-odds] Primary failed:`, e);
      }
    }

    // Step 3: Try backup provider if primary failed
    if (!odds || odds.length === 0) {
      const BACKUP_KEY = Deno.env.get("ODDS_API_IO_KEY");
      if (BACKUP_KEY) {
        try {
          console.log(`[get-odds] Fetching from backup (odds-api-io)...`);
          odds = await getOddsFromOddsApiIo(BACKUP_KEY, sport, market, eventId, bookmaker);
          provider = "odds-api-io";
          fallbackUsed = true;
          console.log(`[get-odds] Backup returned ${odds.length} entries`);
        } catch (e) {
          console.error(`[get-odds] Backup failed:`, e);
        }
      }
    }

    // Step 4: If we got fresh odds, cache them and return
    if (odds && odds.length > 0) {
      // Cache in background
      upsertCache(supabase, odds, ttl).catch((e) => console.error("[get-odds] Cache write error:", e));

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
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 6: Nothing available
    console.warn("[get-odds] No odds available from any source");
    return new Response(JSON.stringify({
      ok: false,
      data: [],
      meta: {
        provider: "none",
        fetchedAt: new Date().toISOString(),
        isStale: false,
        fallbackUsed: true,
        fromCache: false,
        count: 0,
      },
      error: "No odds available from any provider or cache",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[get-odds] Error:", e);
    return new Response(JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
