// =============================================================================
// Sport-aware league team membership
// =============================================================================
import { NBA_TEAMS, isNbaTeam } from "@/lib/nbaTeams";
import { WNBA_TEAMS, isWnbaTeam } from "@/lib/sports/wnbaTeams";
import { isPostseasonTeam } from "@/lib/postseasonTeams";
import type { SportKey } from "@/lib/sports/registry";

// Empty placeholder set for sports without team data wired up yet (e.g. MLB).
const EMPTY_TEAMS: Set<string> = new Set();

export function getLeagueTeams(sport: SportKey): Set<string> {
  if (sport === "WNBA") return WNBA_TEAMS;
  if (sport === "NBA") return NBA_TEAMS;
  return EMPTY_TEAMS;
}

export function isLeagueTeam(sport: SportKey, teamAbbr: string | null): boolean {
  if (!teamAbbr) return false;
  if (sport === "WNBA") return isWnbaTeam(teamAbbr);
  if (sport === "NBA") return isNbaTeam(teamAbbr);
  return false;
}

/**
 * Sport-aware "in-scope" team check.
 *
 * NBA — restrict to current postseason teams (delegates to postseasonTeams.ts).
 * WNBA — accept any valid WNBA team (no postseason narrowing in Phase 1).
 * MLB — placeholder; no team data wired yet, returns false.
 */
export function isInScopeTeam(sport: SportKey, teamAbbr: string | null): boolean {
  if (!teamAbbr) return false;
  if (sport === "NBA") {
    return isNbaTeam(teamAbbr) && isPostseasonTeam(teamAbbr);
  }
  if (sport === "WNBA") return isWnbaTeam(teamAbbr);
  return false;
}
