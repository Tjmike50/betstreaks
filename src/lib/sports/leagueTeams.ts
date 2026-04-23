// =============================================================================
// Sport-aware league team membership
// =============================================================================
import { NBA_TEAMS, isNbaTeam } from "@/lib/nbaTeams";
import { WNBA_TEAMS, isWnbaTeam } from "@/lib/sports/wnbaTeams";
import { isPostseasonTeam } from "@/lib/postseasonTeams";
import type { SportKey } from "@/lib/sports/registry";

// All 30 MLB team abbreviations (standard).
const MLB_TEAMS = new Set([
  "ARI","ATL","BAL","BOS","CHC","CHW","CIN","CLE","COL","DET",
  "HOU","KC","LAA","LAD","MIA","MIL","MIN","NYM","NYY","OAK",
  "PHI","PIT","SD","SF","SEA","STL","TB","TEX","TOR","WSH",
]);

function isMlbTeam(abbr: string): boolean {
  return MLB_TEAMS.has(abbr.toUpperCase());
}

export function getLeagueTeams(sport: SportKey): Set<string> {
  if (sport === "WNBA") return WNBA_TEAMS;
  if (sport === "NBA") return NBA_TEAMS;
  if (sport === "MLB") return MLB_TEAMS;
  return new Set();
}

export function isLeagueTeam(sport: SportKey, teamAbbr: string | null): boolean {
  if (!teamAbbr) return false;
  if (sport === "WNBA") return isWnbaTeam(teamAbbr);
  if (sport === "NBA") return isNbaTeam(teamAbbr);
  if (sport === "MLB") return isMlbTeam(teamAbbr);
  return false;
}

/**
 * Sport-aware "in-scope" team check.
 *
 * NBA — restrict to current postseason teams (delegates to postseasonTeams.ts).
 * WNBA — accept any valid WNBA team (no postseason narrowing in Phase 1).
 * MLB — accept any valid MLB team (full regular season).
 */
export function isInScopeTeam(sport: SportKey, teamAbbr: string | null): boolean {
  if (!teamAbbr) return false;
  if (sport === "NBA") {
    return isNbaTeam(teamAbbr) && isPostseasonTeam(teamAbbr);
  }
  if (sport === "WNBA") return isWnbaTeam(teamAbbr);
  if (sport === "MLB") return isMlbTeam(teamAbbr);
  return false;
}
