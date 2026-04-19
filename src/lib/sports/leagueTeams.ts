// =============================================================================
// Sport-aware league team membership
// =============================================================================
// Wraps the per-league team sets (NBA + WNBA) behind a single API. Keeps
// callers from needing to import each league's team file individually.

import { NBA_TEAMS, isNbaTeam } from "@/lib/nbaTeams";
import { WNBA_TEAMS, isWnbaTeam } from "@/lib/sports/wnbaTeams";
import type { SportKey } from "@/lib/sports/registry";

export function getLeagueTeams(sport: SportKey): Set<string> {
  return sport === "WNBA" ? WNBA_TEAMS : NBA_TEAMS;
}

export function isLeagueTeam(sport: SportKey, teamAbbr: string | null): boolean {
  if (!teamAbbr) return false;
  return sport === "WNBA" ? isWnbaTeam(teamAbbr) : isNbaTeam(teamAbbr);
}

/**
 * Sport-aware "in-scope" team check.
 *
 * NBA — restrict to current postseason teams (delegates to postseasonTeams.ts).
 * WNBA — accept any valid WNBA team (no postseason narrowing in Phase 1).
 */
export function isInScopeTeam(sport: SportKey, teamAbbr: string | null): boolean {
  if (!teamAbbr) return false;
  if (sport === "NBA") {
    // Defer to existing NBA postseason logic
    // Lazy import to avoid pulling postseason config into WNBA paths
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isPostseasonTeam } = require("@/lib/postseasonTeams") as {
      isPostseasonTeam: (t: string | null) => boolean;
    };
    return isNbaTeam(teamAbbr) && isPostseasonTeam(teamAbbr);
  }
  return isWnbaTeam(teamAbbr);
}
