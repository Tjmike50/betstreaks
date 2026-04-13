/**
 * Postseason team configuration — single source of truth for the frontend.
 *
 * Modes:
 *   "play_in"  → 20 teams (Play-In tournament + playoff qualifiers)
 *   "playoffs" → 16 teams (bracket is set, Play-In complete)
 *   "active"   → only teams still alive (update after each round)
 *
 * To switch modes, change POSTSEASON_MODE below.
 */

export type PostseasonMode = "play_in" | "playoffs" | "active";

// ── Current mode ─────────────────────────────────────────────
export const POSTSEASON_MODE: PostseasonMode = "play_in";

// ── 20 Play-In + Playoff teams (2025-26 season) ─────────────
const PLAY_IN_TEAMS = new Set([
  // East playoff locks (1-6 seeds)
  "CLE", "BOS", "NYK", "IND", "MIL", "DET",
  // East Play-In (7-10 seeds)
  "ORL", "ATL", "CHI", "MIA",
  // West playoff locks (1-6 seeds)
  "OKC", "HOU", "LAL", "DEN", "LAC", "MIN",
  // West Play-In (7-10 seeds)
  "GSW", "MEM", "SAC", "SAS",
]);

// ── 16 Playoff teams (update once Play-In resolves) ─────────
const PLAYOFF_TEAMS = new Set([
  // East (1-8)
  "CLE", "BOS", "NYK", "IND", "MIL", "DET", "ORL", "ATL",
  // West (1-8)
  "OKC", "HOU", "LAL", "DEN", "LAC", "MIN", "GSW", "MEM",
]);

// ── Active teams (narrow after each round) ───────────────────
const ACTIVE_TEAMS = new Set(PLAYOFF_TEAMS);

// ── Resolver ─────────────────────────────────────────────────
export function getPostseasonTeams(): Set<string> {
  switch (POSTSEASON_MODE) {
    case "play_in":
      return PLAY_IN_TEAMS;
    case "playoffs":
      return PLAYOFF_TEAMS;
    case "active":
      return ACTIVE_TEAMS;
    default:
      return PLAY_IN_TEAMS;
  }
}

/** Array version for Supabase .in() queries */
export function getPostseasonTeamsArray(): string[] {
  return Array.from(getPostseasonTeams());
}

/** Check if a team is postseason-relevant */
export function isPostseasonTeam(teamAbbr: string | null): boolean {
  return teamAbbr !== null && getPostseasonTeams().has(teamAbbr);
}
