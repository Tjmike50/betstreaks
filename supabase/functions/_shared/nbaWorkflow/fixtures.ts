import { fixtureSnapshot, fixtureSource } from "../analyticsAssistant/fixtures.ts";
import type { Board, Market } from "./domain.ts";

export const fixtureBoard: Board = {
  snapshot: fixtureSnapshot,
  asOf: "2026-11-10T12:00:00.000Z",
  markets: [
    {
      id: "fixture-avery-pts", eventId: "fixture-bos-nyk", date: "2026-11-10",
      matchup: "BOS vs NYK", player: fixtureSource.players[0], metric: "PTS", side: "over",
      score: { value: 62, asOf: "2026-11-10T11:45:00.000Z", missing: ["Verified minutes"],
        factors: [{ label: "Recent form", contribution: 8 }, { label: "Matchup", contribution: 6 },
          { label: "Volatility", contribution: -2 }] },
      availability: { status: "available", observedAt: "2026-11-10T11:55:00.000Z" },
      result: { state: "pending", value: null, observedAt: "2026-11-10T11:55:00.000Z" },
      quotes: [
        { book: "Demo North", line: 20.5, price: -115, main: true, observedAt: "2026-11-10T11:45:00.000Z" },
        { book: "Demo North", line: 19.5, price: -135, main: false, observedAt: "2026-11-10T11:45:00.000Z" },
        { book: "Demo South", line: 20.5, price: -108, main: true, observedAt: "2026-11-10T11:50:00.000Z" },
      ],
      previousQuotes: [
        { book: "Demo North", line: 19.5, price: -110, main: true, observedAt: "2026-11-10T09:00:00.000Z" },
        { book: "Demo South", line: 20.5, price: +102, main: true, observedAt: "2026-11-10T09:00:00.000Z" },
      ],
    },
    {
      id: "fixture-jordan-ast", eventId: "fixture-bos-nyk", date: "2026-11-10",
      matchup: "BOS vs NYK", player: fixtureSource.players[2], metric: "AST", side: "at_least", score: null,
      availability: { status: "questionable", observedAt: "2026-11-10T11:35:00.000Z" },
      result: { state: "pending", value: null, observedAt: "2026-11-10T11:35:00.000Z" },
      quotes: [{ book: "Demo North", line: 4, price: -120, main: true, observedAt: "2026-11-10T11:45:00.000Z" }],
      previousQuotes: [],
    },
    {
      id: "fixture-casey-reb", eventId: "fixture-chi-den", date: "2026-11-09",
      matchup: "CHI vs DEN", player: fixtureSource.players[3], metric: "REB", side: "over", score: null,
      availability: { status: "available", observedAt: "2026-11-09T18:00:00.000Z" },
      result: { state: "final", value: 5, observedAt: "2026-11-09T23:45:00.000Z" },
      quotes: [{ book: "Demo South", line: 5, price: -110, main: true, observedAt: "2026-11-09T18:00:00.000Z" }],
      previousQuotes: [],
    },
  ],
};

export function advanceFixture(board: Board): Board {
  const asOf = "2026-11-10T23:45:00.000Z";
  return {
    ...board, asOf, snapshot: { ...board.snapshot, revision: "nba-fixtures-v2" },
    markets: board.markets.map((market): Market => {
      if (market.id === "fixture-avery-pts") return {
        ...market,
        previousQuotes: market.quotes,
        quotes: market.quotes.map((quote) => quote.book === "Demo North" && quote.main
          ? { ...quote, line: 21.5, price: -115, observedAt: asOf }
          : { ...quote, price: quote.price + (quote.price > -110 ? 218 : 0), observedAt: asOf }),
        result: { state: "final", value: 20, observedAt: asOf },
      };
      if (market.id === "fixture-jordan-ast") return {
        ...market, availability: { status: "out", observedAt: asOf },
        result: { state: "void", value: null, observedAt: asOf }, previousQuotes: market.quotes, quotes: [],
      };
      return market;
    }),
  };
}
