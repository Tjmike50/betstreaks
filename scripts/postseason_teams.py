"""
Postseason team configuration — single source of truth for the Python refresh pipeline.

Modes:
  "all"     → all NBA teams (default)
  "play_in"  → 20 teams (Play-In tournament + playoff qualifiers)
  "playoffs" → 16 teams (bracket is set, Play-In complete)
  "active"   → only teams still alive (update after each round)

Set NBA_POSTSEASON_MODE to opt into a narrower postseason scope.
"""

from os import environ

from nba_api.stats.static import teams

POSTSEASON_MODE = environ.get("NBA_POSTSEASON_MODE", "all")

# ── 20 Play-In + Playoff teams (2025-26 season) ─────────────
PLAY_IN_TEAMS = {
    # East playoff locks (1-6 seeds)
    "CLE", "BOS", "NYK", "IND", "MIL", "DET",
    # East Play-In (7-10 seeds)
    "ORL", "ATL", "CHI", "MIA",
    # West playoff locks (1-6 seeds)
    "OKC", "HOU", "LAL", "DEN", "LAC", "MIN",
    # West Play-In (7-10 seeds)
    "GSW", "MEM", "SAC", "SAS",
}

# ── 16 Playoff teams (update once Play-In resolves) ─────────
PLAYOFF_TEAMS = {
    # East (1-8)
    "CLE", "BOS", "NYK", "IND", "MIL", "DET", "ORL", "ATL",
    # West (1-8)
    "OKC", "HOU", "LAL", "DEN", "LAC", "MIN", "GSW", "MEM",
}

# ── Active teams (narrow after each round) ───────────────────
ACTIVE_TEAMS = PLAYOFF_TEAMS.copy()  # Start same as playoffs, remove eliminated teams

# ── Resolver ─────────────────────────────────────────────────
def get_postseason_teams() -> set[str]:
    """Return the set of team abbreviations for the current postseason mode."""
    if POSTSEASON_MODE == "all":
        return {team["abbreviation"] for team in teams.get_teams()}
    elif POSTSEASON_MODE == "play_in":
        return PLAY_IN_TEAMS
    elif POSTSEASON_MODE == "playoffs":
        return PLAYOFF_TEAMS
    elif POSTSEASON_MODE == "active":
        return ACTIVE_TEAMS
    else:
        raise ValueError(f"Unknown POSTSEASON_MODE: {POSTSEASON_MODE}")
