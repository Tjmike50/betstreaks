import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { paidWeeklyPass, validWeekCount } from "./weeklyPass.ts";
Deno.test("only accepts bounded whole numeric weeks", () => {
  for (const value of [1, 9, 43, 520]) assertEquals(validWeekCount(value), true);
  for (const value of [0, -1, 1.5, 521, NaN, Infinity, "9", null, undefined]) assertEquals(validWeekCount(value), false);
});
Deno.test("weekly grant requires exact paid USD total", () => {
  for (const weeks of [9, 43]) {
    const session = { id: "cs_paid", mode: "payment", payment_status: "paid", currency: "usd", amount_total: weeks * 500, metadata: { plan: "weekly_pass", weeks: String(weeks) } };
    assertEquals(paidWeeklyPass(session), { sessionId: "cs_paid", weeks });
    for (const change of [{ payment_status: "unpaid" }, { amount_total: 1 }, { currency: "eur" }, { mode: "subscription" }, { metadata: { plan: "weekly_pass", weeks: "0" } }]) assertEquals(paidWeeklyPass({ ...session, ...change }), null);
  }
});
