export type AmericanOddsInput = string | number | null | undefined;

function normalizeAmericanOdds(input: AmericanOddsInput): number | null {
  if (input == null) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) && input !== 0 ? input : null;
  }

  const cleaned = String(input)
    .trim()
    .replace(/[−–—]/g, "-")
    .replace(/^\+/, "");
  if (!cleaned) return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed === 0) return null;
  return parsed;
}

export function americanToDecimal(odds: AmericanOddsInput): number | null {
  const normalized = normalizeAmericanOdds(odds);
  if (normalized == null) return null;
  return normalized > 0
    ? 1 + normalized / 100
    : 1 + 100 / Math.abs(normalized);
}

export function decimalToAmerican(decimal: number | null | undefined): string | null {
  if (decimal == null || !Number.isFinite(decimal) || decimal <= 1) return null;
  if (decimal >= 2) {
    return `+${Math.round((decimal - 1) * 100)}`;
  }
  return `${Math.round(-100 / (decimal - 1))}`;
}

export function parlayAmerican(odds: AmericanOddsInput[]): string | null {
  const decimals = odds.map(americanToDecimal);
  if (decimals.some((value) => value == null)) return null;
  const parlayDecimal = decimals.reduce((acc, value) => acc * (value as number), 1);
  return decimalToAmerican(parlayDecimal);
}

