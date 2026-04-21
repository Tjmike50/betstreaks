// =============================================================================
// MLB stat label utilities — compact, mobile-friendly display labels.
// =============================================================================

/** Map raw stat_type keys to compact display labels for MLB. */
const MLB_LABELS: Record<string, string> = {
  STRIKEOUTS: "K",
  EARNED_RUNS_ALLOWED: "ER",
  WALKS_ALLOWED: "BB",
  HITS_ALLOWED: "H Allowed",
  HOME_RUNS: "HR",
  TOTAL_BASES: "TB",
  HITS: "Hits",
};

/**
 * Return a compact stat label for display. MLB stat types get short forms;
 * everything else passes through as-is.
 */
export function compactStatLabel(stat: string): string {
  return MLB_LABELS[stat.toUpperCase()] ?? stat;
}

/** Returns true if the stat type is a known MLB prop stat. */
export function isMlbStat(stat: string): boolean {
  return stat.toUpperCase() in MLB_LABELS;
}
