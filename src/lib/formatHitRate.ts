export function normalizeHitRatePercent(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return null;

  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, percent));
}

export function formatHitRate(value: number | null | undefined): string {
  const percent = normalizeHitRatePercent(value);
  if (percent == null) return "—";
  return `${Math.round(percent)}%`;
}

