import { failure, isDate, metrics, type Calculation, type Evidence, type Outcome, type Player,
  type Provenance, type Query, type Snapshot } from "./contract.ts";
import type { Appearance, GameLogSource } from "./source.ts";

export function validSnapshot(snapshot: Snapshot | null): snapshot is Snapshot {
  return Boolean(snapshot?.dataset && snapshot?.revision && snapshot?.source &&
    isDate(snapshot.coverageThrough) && Number.isFinite(Date.parse(snapshot.snapshotAt)) &&
    (snapshot.fetchedAt === null || Number.isFinite(Date.parse(snapshot.fetchedAt))) &&
    (snapshot.mode === "fixture" || (snapshot.mode === "verified" && snapshot.fetchedAt)));
}

function compute(query: Query, values: number[]): Calculation {
  const { operation } = query;
  if (operation.kind === "average") {
    const sum = values.reduce((total, value) => total + value, 0);
    return { kind: "average", sum, denominator: values.length, value: sum / values.length };
  }
  const { comparator, threshold } = operation;
  const above = values.filter((value) => value > threshold).length;
  const below = values.filter((value) => value < threshold).length;
  const ties = values.length - above - below;
  const hits = { gt: above, gte: above + ties, lt: below, lte: below + ties, eq: ties }[comparator];
  return {
    kind: "count", comparator, threshold, hits, denominator: values.length, ties,
    pushes: comparator === "gt" || comparator === "lt" ? ties : 0,
  };
}

export async function calculate(
  source: GameLogSource,
  query: Query,
  player: Player,
  now: Date,
  signal: AbortSignal,
): Promise<Outcome> {
  const snapshot = source.snapshot;
  if (!validSnapshot(snapshot)) return failure("DATASET_UNAVAILABLE");
  const stale = query.asOf > snapshot.coverageThrough;
  const provenance: Provenance = {
    ...snapshot,
    freshness: stale ? "stale" : snapshot.mode === "fixture" ? "frozen_fixture" : "verified_snapshot",
    computedAt: now.toISOString(),
    latestGameDate: null,
  };
  if (stale) return { ...failure("STALE_SOURCE"), query, player, provenance };

  const { rows, complete } = await source.readGames(query, signal);
  signal.throwIfAborted();
  if (!complete) return { ...failure("DATA_UNVERIFIED"), query, player, provenance };

  const unique = new Map<string, Appearance>();
  const stat = metrics[query.metric].column;
  for (const row of rows) {
    if (row.sport !== query.sport || row.player_id !== query.playerId) continue;
    if (!isDate(row.game_date) || !row.game_id ||
        !["final", "dnp", "scheduled", "unknown"].includes(row.eligibility)) {
      return { ...failure("DATA_UNVERIFIED"), query, player, provenance };
    }
    if (row.game_date > query.asOf) continue;
    const prior = unique.get(row.game_id);
    if (prior && (prior.game_date !== row.game_date || prior.eligibility !== row.eligibility ||
        prior[stat] !== row[stat])) {
      return { ...failure("DATA_UNVERIFIED"), query, player, provenance };
    }
    unique.set(row.game_id, row);
  }

  const window = [...unique.values()]
    .filter((row) => row.eligibility === "final" || row.eligibility === "unknown")
    .sort((a, b) => a.game_date === b.game_date
      ? (a.game_id < b.game_id ? 1 : a.game_id > b.game_id ? -1 : 0)
      : (a.game_date < b.game_date ? 1 : -1))
    .slice(0, query.window);
  provenance.latestGameDate = window.find((row) => row.eligibility === "final")?.game_date ?? null;
  if (window.some((row) => row.eligibility === "unknown")) {
    return { ...failure("DATA_UNVERIFIED"), query, player, provenance };
  }

  const evidence: Evidence[] = window.map((row) => ({
    gameId: row.game_id, date: row.game_date, value: row[stat],
  }));
  if (evidence.some(({ value }) => value !== null &&
      (!Number.isSafeInteger(value) || value < 0 || value > 200))) {
    return { ...failure("DATA_UNVERIFIED"), query, player, provenance };
  }
  const values = evidence.flatMap(({ value }) => value === null ? [] : [value]);
  const coverage = {
    requested: query.window,
    appearances: window.length,
    known: values.length,
    missing: window.length - values.length,
  };
  const base = { query, player, evidence, coverage, provenance };
  if (window.length === 0) return { ...failure("NO_GAMES"), ...base };
  if (values.length !== query.window) return { ...failure("INSUFFICIENT_COVERAGE"), ...base };
  return { status: "answer", ...base, calculation: compute(query, values) };
}
