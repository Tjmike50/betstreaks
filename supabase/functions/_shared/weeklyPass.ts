export const WEEKLY_PRICE_CENTS = 500;
export const MAX_PREPAID_WEEKS = 520;

export function validWeekCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PREPAID_WEEKS;
}

export function paidWeeklyPass(session: {
  id?: unknown; mode?: unknown; payment_status?: unknown; currency?: unknown;
  amount_total?: unknown; metadata?: Record<string, unknown>;
}): { sessionId: string; weeks: number } | null {
  const raw = session.metadata?.weeks;
  const weeks = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (session.metadata?.plan !== "weekly_pass" || !validWeekCount(weeks)
    || session.mode !== "payment" || session.payment_status !== "paid"
    || session.currency !== "usd" || session.amount_total !== weeks * WEEKLY_PRICE_CENTS
    || typeof session.id !== "string" || !session.id.startsWith("cs_")) return null;
  return { sessionId: session.id, weeks };
}
