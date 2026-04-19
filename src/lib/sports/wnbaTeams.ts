// =============================================================================
// WNBA team metadata (2024-25 season — 13 teams)
// =============================================================================
export const WNBA_TEAMS = new Set([
  "ATL", // Atlanta Dream
  "CHI", // Chicago Sky
  "CON", // Connecticut Sun
  "DAL", // Dallas Wings
  "GSV", // Golden State Valkyries (expansion 2025)
  "IND", // Indiana Fever
  "LAS", // Las Vegas Aces  (note: Aces use "LVA" in some feeds — keep both)
  "LVA", // Las Vegas Aces (alt abbr)
  "LAS_LA", // sentinel — never set, kept for clarity
  "LA",  // Los Angeles Sparks
  "MIN", // Minnesota Lynx
  "NYL", // New York Liberty
  "PHO", // Phoenix Mercury (also "PHX" in some feeds)
  "PHX", // Phoenix Mercury (alt)
  "SEA", // Seattle Storm
  "WAS", // Washington Mystics
]);

export function isWnbaTeam(teamAbbr: string | null): boolean {
  return teamAbbr !== null && WNBA_TEAMS.has(teamAbbr);
}
