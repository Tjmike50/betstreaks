import { supabase } from "@/integrations/supabase/client";
import { metrics } from "../../../supabase/functions/_shared/analyticsAssistant/contract";
import { selectionFor, sideLabel, type Board, type Market, type Quote, type Selection } from "../../../supabase/functions/_shared/nbaWorkflow/domain";

export const nbaWorkflowEnabled = import.meta.env.VITE_NBA_WORKFLOW_ENABLED === "true";
export const nbaFixtureControls = import.meta.env.VITE_NBA_WORKFLOW_FIXTURE_CONTROLS === "true";
export const nbaWorkflowPath = "/research/nba";
export const formatPrice = (price: number) => price > 0 ? `+${price}` : String(price);
export const formatStamp = (stamp: string) => new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
}).format(new Date(stamp));
export const marketLabel = (market: Market) => `${market.player.name} · ${metrics[market.metric].label} · ${sideLabel[market.side]}`;
export const selectionKey = (selection: Selection) => JSON.stringify([selection.marketId, selection.book, selection.line]);
export const quoteKey = (market: Market, quote: Quote) => selectionKey(selectionFor(market, quote));

export async function callWorkflow<T>(body: object): Promise<{ data: T; reference: string }> {
  const { data, error } = await supabase.functions.invoke("nba-workflow", { body });
  if (error) {
    const result = error.context instanceof Response ? await error.context.json().catch(() => null) : null;
    throw new Error(typeof result?.error === "string" ? result.error : "NBA research is temporarily unavailable.");
  }
  if (typeof data?.reference !== "string" || data.data == null) throw new Error("NBA research returned an incomplete response.");
  return data as { data: T; reference: string };
}

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseMetric(text: string) {
  switch (normalize(text).replace(/^player_/, "")) {
    case "pts": case "point": case "points": return "PTS";
    case "reb": case "rebound": case "rebounds": return "REB";
    case "ast": case "assist": case "assists": return "AST";
    case "3pm": case "threes": case "fg3m": case "three-pointers made": return "3PM";
    default: return undefined;
  }
}

export type ImportedLeg = { player: string; metric: string; side: string; line: string; book?: string; team?: string };

function matchLeg(leg: ImportedLeg, board: Board) {
  const marketSide = normalize(leg.side).replace(/^at least$/, "at_least");
  const line = /^\d+(?:\.\d+)?$/.test(leg.line.trim()) ? Number(leg.line) : NaN;
  return board.markets
    .filter((market) => normalize(market.player.name) === normalize(leg.player) &&
      (!leg.team || normalize(leg.team) === normalize(market.player.team)) &&
      market.metric === parseMetric(leg.metric) && market.side === marketSide)
    .flatMap((market) => market.quotes.filter((quote) => quote.line === line &&
      (!leg.book || normalize(quote.book) === normalize(leg.book))).map((quote) => ({ market, quote })));
}

export function importDraft(legs: ImportedLeg[], board: Board) {
  return legs.map((leg) => ({ label: `${leg.player} · ${leg.side} ${leg.line} ${leg.metric}`, matches: matchLeg(leg, board) }));
}

export function parseSlipText(text: string): ImportedLeg[] {
  const rows = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (!rows.length || rows.length > 8) throw new Error("Paste one to eight lines.");
  return rows.map((row, i) => {
    const [player, metric, side, line, book, ...extra] = row.split("|").map((value) => value.trim());
    if (!player || !metric || !side || !line || extra.length) {
      throw new Error(`Check row ${i + 1}. Use Player | Stat | Side | Line | Sportsbook.`);
    }
    return { player, metric, side, line, book };
  });
}

export function adaptLegacyLegs(legs: {
  player_name: string; stat_type: string; line: string; pick: string;
  team_abbr?: string | null; data_context?: { odds_source?: string | null } | null;
}[]): ImportedLeg[] {
  return legs.filter((leg) => !!leg.player_name.trim() && !!leg.line.trim()).map((leg) => {
    const explicit = /^(over|under|at least)\s+(\d+(?:\.\d+)?)$/i.exec(leg.line.trim());
    return {
      player: leg.player_name, metric: leg.stat_type, line: explicit?.[2] ?? leg.line,
      side: explicit?.[1] ?? leg.pick, book: leg.data_context?.odds_source ?? undefined, team: leg.team_abbr ?? undefined,
    };
  });
}
