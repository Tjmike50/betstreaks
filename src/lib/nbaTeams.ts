// Official NBA team abbreviations - excludes G League teams
export const NBA_TEAMS = new Set([
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
]);

// Filter streaks to only include NBA teams
export function isNbaTeam(teamAbbr: string | null): boolean {
  return teamAbbr !== null && NBA_TEAMS.has(teamAbbr);
}
