import { describe, expect, it } from "vitest";
import { formatHitRate } from "@/lib/formatHitRate";

describe("formatHitRate", () => {
  it("formats decimal perfect rate as 100%", () => {
    expect(formatHitRate(1)).toBe("100%");
  });

  it("formats decimal rates as percentages", () => {
    expect(formatHitRate(0.8)).toBe("80%");
    expect(formatHitRate(0.01)).toBe("1%");
  });

  it("preserves already-percent values", () => {
    expect(formatHitRate(80)).toBe("80%");
    expect(formatHitRate(100)).toBe("100%");
  });

  it("returns dash for nullish or invalid input", () => {
    expect(formatHitRate(null)).toBe("—");
    expect(formatHitRate(undefined)).toBe("—");
    expect(formatHitRate(Number.NaN)).toBe("—");
  });
});

