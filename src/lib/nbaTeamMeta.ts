/** NBA team metadata for UI rendering — colors & full names */

export interface NbaTeamMeta {
  name: string;       // e.g. "Celtics"
  city: string;       // e.g. "Boston"
  color: string;      // primary HSL color
  colorAlt: string;   // secondary HSL color
}

const teams: Record<string, NbaTeamMeta> = {
  ATL: { name: "Hawks",        city: "Atlanta",       color: "0 68% 53%",     colorAlt: "48 100% 50%" },
  BOS: { name: "Celtics",      city: "Boston",        color: "136 73% 34%",   colorAlt: "40 100% 50%" },
  BKN: { name: "Nets",         city: "Brooklyn",      color: "0 0% 15%",      colorAlt: "0 0% 50%" },
  CHA: { name: "Hornets",      city: "Charlotte",     color: "195 100% 35%",  colorAlt: "265 60% 50%" },
  CHI: { name: "Bulls",        city: "Chicago",       color: "0 72% 46%",     colorAlt: "0 0% 15%" },
  CLE: { name: "Cavaliers",    city: "Cleveland",     color: "355 70% 35%",   colorAlt: "40 80% 45%" },
  DAL: { name: "Mavericks",    city: "Dallas",        color: "212 68% 42%",   colorAlt: "212 30% 25%" },
  DEN: { name: "Nuggets",      city: "Denver",        color: "220 60% 30%",   colorAlt: "45 100% 52%" },
  DET: { name: "Pistons",      city: "Detroit",       color: "0 68% 45%",     colorAlt: "215 70% 40%" },
  GSW: { name: "Warriors",     city: "Golden State",  color: "220 78% 42%",   colorAlt: "45 100% 52%" },
  HOU: { name: "Rockets",      city: "Houston",       color: "0 72% 46%",     colorAlt: "0 0% 15%" },
  IND: { name: "Pacers",       city: "Indiana",       color: "220 60% 30%",   colorAlt: "45 100% 52%" },
  LAC: { name: "Clippers",     city: "Los Angeles",   color: "0 68% 45%",     colorAlt: "218 70% 42%" },
  LAL: { name: "Lakers",       city: "Los Angeles",   color: "265 65% 42%",   colorAlt: "45 100% 52%" },
  MEM: { name: "Grizzlies",    city: "Memphis",       color: "210 50% 38%",   colorAlt: "198 80% 48%" },
  MIA: { name: "Heat",         city: "Miami",         color: "355 70% 40%",   colorAlt: "0 0% 15%" },
  MIL: { name: "Bucks",        city: "Milwaukee",     color: "142 55% 30%",   colorAlt: "48 60% 45%" },
  MIN: { name: "Timberwolves", city: "Minnesota",     color: "218 60% 30%",   colorAlt: "142 50% 40%" },
  NOP: { name: "Pelicans",     city: "New Orleans",   color: "218 60% 30%",   colorAlt: "45 100% 52%" },
  NYK: { name: "Knicks",       city: "New York",      color: "218 70% 42%",   colorAlt: "24 90% 52%" },
  OKC: { name: "Thunder",      city: "Oklahoma City", color: "210 70% 42%",   colorAlt: "20 80% 50%" },
  ORL: { name: "Magic",        city: "Orlando",       color: "215 60% 35%",   colorAlt: "0 0% 15%" },
  PHI: { name: "76ers",        city: "Philadelphia",  color: "218 70% 42%",   colorAlt: "0 68% 45%" },
  PHX: { name: "Suns",         city: "Phoenix",       color: "24 90% 50%",    colorAlt: "265 50% 40%" },
  POR: { name: "Trail Blazers",city: "Portland",      color: "0 68% 45%",     colorAlt: "0 0% 15%" },
  SAC: { name: "Kings",        city: "Sacramento",    color: "265 55% 40%",   colorAlt: "0 0% 15%" },
  SAS: { name: "Spurs",        city: "San Antonio",   color: "0 0% 15%",      colorAlt: "0 0% 50%" },
  TOR: { name: "Raptors",      city: "Toronto",       color: "0 68% 45%",     colorAlt: "0 0% 15%" },
  UTA: { name: "Jazz",         city: "Utah",          color: "218 60% 30%",   colorAlt: "45 100% 52%" },
  WAS: { name: "Wizards",      city: "Washington",    color: "218 60% 30%",   colorAlt: "0 68% 45%" },
};

/** Resolve team abbreviation from a nickname like "Clippers" or an abbreviation like "LAC" */
export function resolveTeamAbbr(identifier: string | null | undefined): string | null {
  if (!identifier) return null;
  const upper = identifier.toUpperCase();
  if (teams[upper]) return upper;
  // Try matching by name
  const lower = identifier.toLowerCase();
  for (const [abbr, meta] of Object.entries(teams)) {
    if (meta.name.toLowerCase() === lower || meta.city.toLowerCase() === lower) return abbr;
  }
  return null;
}

export function getTeamMeta(abbr: string | null | undefined): NbaTeamMeta | null {
  if (!abbr) return null;
  return teams[abbr.toUpperCase()] || null;
}

export default teams;
