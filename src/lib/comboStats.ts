// Combo stat configuration for Premium Player Combos feature

export const COMBO_STATS = ["PA", "PR", "RA", "PRA"] as const;
export type ComboStat = typeof COMBO_STATS[number];

export const COMBO_STAT_OPTIONS: { label: string; value: ComboStat }[] = [
  { label: "PTS + AST", value: "PA" },
  { label: "PTS + REB", value: "PR" },
  { label: "REB + AST", value: "RA" },
  { label: "PTS + REB + AST", value: "PRA" },
];

// Friendly display labels for combo stats (used in cards and detail pages)
export const COMBO_FRIENDLY_LABELS: Record<ComboStat, string> = {
  PA: "PTS+AST",
  PR: "PTS+REB",
  RA: "REB+AST",
  PRA: "PTS+REB+AST",
};

// Check if a stat is a combo stat
export function isComboStat(stat: string): stat is ComboStat {
  return COMBO_STATS.includes(stat as ComboStat);
}

// Get the friendly label for any stat (combo or regular)
export function getStatFriendlyLabel(stat: string): string {
  if (isComboStat(stat)) {
    return COMBO_FRIENDLY_LABELS[stat];
  }
  return stat;
}

// Calculate combo stat value from game data
export function calculateComboValue(
  stat: string,
  gameData: { pts?: number | null; reb?: number | null; ast?: number | null }
): number | null {
  const pts = gameData.pts ?? 0;
  const reb = gameData.reb ?? 0;
  const ast = gameData.ast ?? 0;

  switch (stat) {
    case "PA":
      return pts + ast;
    case "PR":
      return pts + reb;
    case "RA":
      return reb + ast;
    case "PRA":
      return pts + reb + ast;
    default:
      return null; // Not a combo stat
  }
}
