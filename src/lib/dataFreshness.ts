// Data freshness configuration
// Threshold in hours after which data is considered stale
export const STALE_THRESHOLD_HOURS = 3;

// Season label
export const CURRENT_SEASON = "2024–25";

// Check if a date is stale (older than threshold)
export function isDataStale(lastUpdate: Date | null, thresholdHours = STALE_THRESHOLD_HOURS): boolean {
  if (!lastUpdate) return false; // If no data, don't show stale warning (show "unavailable" instead)
  
  const now = new Date();
  const diffMs = now.getTime() - lastUpdate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  
  return diffHours > thresholdHours;
}

// Get hours since last update
export function getHoursSinceUpdate(lastUpdate: Date | null): number | null {
  if (!lastUpdate) return null;
  
  const now = new Date();
  const diffMs = now.getTime() - lastUpdate.getTime();
  return diffMs / (1000 * 60 * 60);
}
