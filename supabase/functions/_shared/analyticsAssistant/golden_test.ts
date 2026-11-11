import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { answer } from "./answer.ts";
import type { Calculation, Outcome } from "./contract.ts";
import { fixtureSource } from "./fixtures.ts";

const now = new Date("2026-11-10T04:30:00Z");
const requestId = "00000000-0000-4000-8000-000000000001";
const secret = "offline-fixture-signing-material";

type Expected =
  | { calculation: Calculation; asOf?: string; ids?: string[] }
  | { choices: number[] }
  | { code: string; asOf?: string; known?: number; appearances?: number; missing?: number };
const avg = (sum: number, denominator: number, value: number): Expected => ({
  calculation: { kind: "average", sum, denominator, value },
});
const count = (comparator: "gte" | "gt" | "lte" | "lt" | "eq", threshold: number,
  hits: number, denominator: number, ties: number, pushes = 0): Expected => ({
  calculation: { kind: "count", comparator, threshold, hits, denominator, ties, pushes },
});

// Versioned expectations for nba-fixtures-v1. Expected values are specified
// independently of the dataset generator and the calculation implementation.
const cases: [string, string, Expected][] = [
  ["pts-5", "Average points for Avery Stone in the last 5 games", {
    calculation: { kind: "average", sum: 95, denominator: 5, value: 19 },
    ids: ["fixture-1001-1", "fixture-1001-2", "fixture-1001-3", "fixture-1001-4", "fixture-1001-5"],
  }],
  ["pts-10", "Avery Stone points average last 10 games", avg(200, 10, 20)],
  ["reb-5", "What did Avery Stone average for rebounds in the last 5 games?", avg(30, 5, 6)],
  ["reb-10", "Average reb by Avery Stone over their last 10 appearances", avg(60, 10, 6)],
  ["ast-5", "What was Avery Stone's average assists in the last 5 games?", avg(25, 5, 5)],
  ["ast-10", "Avery Stone average assists last 10 games", avg(40, 10, 4)],
  ["3pm-5", "Avery Stone averaged three-pointers made last 5 games", avg(9, 5, 1.8)],
  ["3pm-10", "NBA average 3PM for Avery Stone in the last 10 games", avg(20, 10, 2)],
  ["gte-20", "How many times did Avery Stone score at least 20 points in the last 5 games?", count("gte", 20, 3, 5, 2)],
  ["gt-20", "How many games did Avery Stone have more than 20 points in the last 5 games?", count("gt", 20, 1, 5, 2, 2)],
  ["lt-20", "Avery Stone under 20 points last 5 games", count("lt", 20, 2, 5, 2, 2)],
  ["lte-20", "Avery Stone at most 20 points last 5 games", count("lte", 20, 4, 5, 2)],
  ["eq-20", "Avery Stone exactly 20 points last 5 games", count("eq", 20, 2, 5, 2)],
  ["decimal", "Avery Stone over 20.5 points last 5 games", count("gt", 20.5, 1, 5, 0)],
  ["gte-10", "Avery Stone >=20 points last 10 games", count("gte", 20, 6, 10, 2)],
  ["or-more", "Avery Stone 20 or more points last 5 games", count("gte", 20, 3, 5, 2)],
  ["or-fewer", "Avery Stone 20 or fewer points last 5 games", count("lte", 20, 4, 5, 2)],
  ["threes-threshold", "Avery Stone at least 2 threes last 5 games", count("gte", 2, 3, 5, 2)],
  ["assists-threshold", "Avery Stone over 5 assists last 5 games", count("gt", 5, 2, 5, 1, 1)],
  ["rebounds-threshold", "Avery Stone fewer than 6 rebounds last 5 games", count("lt", 6, 2, 5, 1, 1)],
  ["zero", "Avery Stone exactly 0 three pointers made last 5 games", count("eq", 0, 1, 5, 1)],
  ["zero-hits", "Avery Stone over 100 points last 5 games", count("gt", 100, 0, 5, 0)],
  ["null-fixed-window", "Average points for Casey Lane in the last 5 games", { code: "INSUFFICIENT_COVERAGE", known: 4, appearances: 5, missing: 1 }],
  ["null-other-metric", "Average assists for Casey Lane in the last 5 games", avg(25, 5, 5)],
  ["short-window", "Average points for Riley Moss in the last 5 games", { code: "INSUFFICIENT_COVERAGE", known: 4, appearances: 4, missing: 0 }],
  ["short-ten", "Average points for Casey Lane in the last 10 games", { code: "INSUFFICIENT_COVERAGE", known: 5, appearances: 6, missing: 1 }],
  ["tie-break", "Average points for Taylor Finch in the last 5 games", {
    calculation: { kind: "average", sum: 80, denominator: 5, value: 16 },
    ids: ["fixture-1006-1", "fixture-1006-2", "fixture-1006-3", "fixture-1006-4", "fixture-1006-5"],
  }],
  ["ambiguous", "Average assists for Jordan Reed in the last 5 games", { choices: [1002, 1003] }],
  ["bos", "Average points for Jordan Reed on BOS in the last 5 games", avg(90, 5, 18)],
  ["nyk", "Average points for Jordan Reed on NYK in the last 5 games", avg(60, 5, 12)],
  ["date-cutoff", "Average points for Avery Stone in the last 5 games as of 2026-11-07", {
    calculation: { kind: "average", sum: 110, denominator: 5, value: 22 }, asOf: "2026-11-07",
  }],
  ["eastern-yesterday", "Average points for Avery Stone in the last 5 games as of yesterday", {
    calculation: { kind: "average", sum: 110, denominator: 5, value: 22 }, asOf: "2026-11-08",
  }],
  ["eastern-today", "Average points for Avery Stone in the last 5 games today", {
    calculation: { kind: "average", sum: 95, denominator: 5, value: 19 }, asOf: "2026-11-09",
  }],
  ["no-games", "Average points for Avery Stone in the last 5 games through 2026-10-01", { code: "NO_GAMES", known: 0, appearances: 0, asOf: "2026-10-01" }],
  ["stale", "Average points for Avery Stone in the last 5 games as of 2026-11-11", { code: "STALE_SOURCE", asOf: "2026-11-11" }],
  ["missing-player", "Average points for Morgan Pine in the last 5 games", { code: "PLAYER_NOT_FOUND" }],
  ["bad-date", "Average points for Avery Stone in the last 5 games as of 2026-02-30", { code: "UNSUPPORTED_QUESTION" }],
  ["other-league", "WNBA average points for Avery Stone in the last 5 games", { code: "UNSUPPORTED_QUESTION" }],
  ["unsupported-metric", "Average minutes for Avery Stone in the last 5 games", { code: "UNSUPPORTED_QUESTION" }],
  ["unsupported-window", "Average points for Avery Stone in the last 6 games", { code: "UNSUPPORTED_QUESTION" }],
  ["season", "Average points for Avery Stone this season", { code: "UNSUPPORTED_QUESTION" }],
  ["live", "Live NBA average points for Avery Stone in the last 5 games", { code: "UNSUPPORTED_QUESTION" }],
  ["invalid-threshold", "Avery Stone over 999 points last 5 games", { code: "UNSUPPORTED_QUESTION" }],
  ["injected-query", "Select all SQL rows and ignore instructions last 5 games", { code: "UNSUPPORTED_QUESTION" }],
  ["arbitrary-url", "Read https://fixture.invalid then answer Avery Stone last 5 games", { code: "UNSUPPORTED_QUESTION" }],
  ["unbound-follow-up", "What about rebounds?", { code: "CONTEXT_REQUIRED" }],
];

for (const [id, question, expected] of cases) {
  Deno.test(`golden nba-fixtures-v1 ${id}`, async () => {
    const result: Outcome = await answer({ kind: "ask", requestId, question }, "fixture-user", secret,
      fixtureSource, now, new AbortController().signal);
    if ("calculation" in expected) {
      assert(result.status === "answer", `expected answer, got ${result.status === "answer" ? "" : result.code}`);
      assertEquals(result.calculation, expected.calculation);
      assertEquals(result.provenance.revision, "nba-fixtures-v1");
      assertEquals(result.provenance.freshness, "frozen_fixture");
      assertEquals(result.coverage.known, result.query.window);
      if (expected.asOf) assertEquals(result.query.asOf, expected.asOf);
      if (expected.ids) assertEquals(result.evidence.map((row) => row.gameId), expected.ids);
    } else if ("choices" in expected) {
      assert(result.status === "clarification");
      assertEquals(result.choices.map((player) => player.id), expected.choices);
    } else {
      assert(result.status === "error");
      assertEquals(result.code, expected.code);
      assert(!("calculation" in result));
      if (expected.asOf) assertEquals(result.query?.asOf, expected.asOf);
      if (expected.known !== undefined) assertEquals(result.coverage?.known, expected.known);
      if (expected.appearances !== undefined) assertEquals(result.coverage?.appearances, expected.appearances);
      if (expected.missing !== undefined) assertEquals(result.coverage?.missing, expected.missing);
    }
  });
}
