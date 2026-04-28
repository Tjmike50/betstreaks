import { describe, expect, it } from "vitest";
import { americanToDecimal, decimalToAmerican, parlayAmerican } from "@/lib/parlayOdds";

describe("parlayOdds", () => {
  it("converts American odds to decimal and back", () => {
    expect(americanToDecimal(-110)).toBeCloseTo(1.9091, 4);
    expect(americanToDecimal("+100")).toBe(2);
    expect(decimalToAmerican(2)).toBe("+100");
    expect(decimalToAmerican(8)).toBe("+700");
  });

  it("computes realistic multi-leg parlay odds", () => {
    const result = parlayAmerican([-110, -111, -325]);
    expect(result).not.toBeNull();
    const numeric = Number((result ?? "").replace(/^\+/, ""));
    expect(numeric).toBeGreaterThanOrEqual(360);
    expect(numeric).toBeLessThanOrEqual(380);
  });

  it("handles even-money parlays exactly", () => {
    expect(parlayAmerican([+100, +100])).toBe("+300");
    expect(parlayAmerican([+100, +100, +100])).toBe("+700");
    expect(parlayAmerican([+100, +100, +100, +100, +100])).toBe("+3100");
  });
});

