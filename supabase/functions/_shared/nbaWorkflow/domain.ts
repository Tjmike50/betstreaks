import { isDate, isPlayerId, isRecord, metrics, type Metric, type Outcome, type Player, type Snapshot } from "../analyticsAssistant/contract.ts";

export type Side = "over" | "under" | "at_least";
export type Quote = { book: string; line: number; price: number; observedAt: string; main: boolean };
export type Market = {
  id: string;
  eventId: string;
  date: string;
  matchup: string;
  player: Player;
  metric: Metric;
  side: Side;
  score: { value: number; factors: { label: string; contribution: number }[]; missing: string[]; asOf: string } | null;
  availability: { status: "available" | "questionable" | "out" | "unknown"; observedAt: string } | null;
  result: { state: "pending" | "postponed" | "void" | "final"; value: number | null; observedAt: string } | null;
  quotes: Quote[];
  previousQuotes: Quote[];
};

export type Board = { snapshot: Snapshot; asOf: string; markets: Market[] };
export type Leg = Pick<Market, "id" | "eventId" | "date" | "player" | "metric" | "side"> & { quote: Quote };
export type Slip = { id: string; name: string; createdAt: string; legs: Leg[] };
export type Watch = {
  leg: Leg; line: boolean; price: boolean; availability: boolean; result: boolean;
  checkpoint: { quote: Quote; availability: Market["availability"]; result: Market["result"] };
};
export type Preferences = { enabled: boolean; quietStart: number; quietEnd: number; timeZone: string };
export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
export type Account = {
  slips: Slip[];
  watch: Watch[];
  preferences: Preferences;
  read: string[];
  updates: Update[];
  subscription: Subscription | null;
};
export const emptyAccount = (): Account => ({
  slips: [], watch: [], preferences: { enabled: false, timeZone: "America/New_York", quietStart: 22, quietEnd: 8 },
  read: [], updates: [], subscription: null,
});

export type Selection = { marketId: string; book: string; line: number; price: number; observedAt: string };
export const selectionFor = (market: Market, quote: Quote): Selection => ({
  marketId: market.id, book: quote.book, line: quote.line, price: quote.price, observedAt: quote.observedAt,
});

export const sideLabel: Record<Side, string> = { over: "Over", under: "Under", at_least: "At least" };
export const tools = ["game_logs", "scores", "quotes", "availability"] as const;
export type ResearchTool = typeof tools[number];
export type ResearchPlan = { tools: ResearchTool[]; line: number; metric: Metric; window: 5 | 10; side: Side };
export type Research = {
  planner: "google" | "rules";
  plan: ResearchPlan;
  evidence?: Outcome;
  score?: Market["score"];
  quotes?: { current: Quote[]; previous: Quote[] };
  availability?: Market["availability"];
};

export type Settlement = "win" | "loss" | "push" | "void" | "pending" | "postponed" | "unverified";

export function settle(leg: Leg, market: Market | undefined): Settlement {
  if (!market) return "unverified";
  const result = market.result;
  if (!result || result.state === "pending") return "pending";
  if (result.state === "void" || result.state === "postponed") return result.state;
  if (result.value === null) return "unverified";
  if (leg.side === "at_least") return result.value >= leg.quote.line ? "win" : "loss";
  if (result.value === leg.quote.line) return "push";
  return (leg.side === "over" ? result.value > leg.quote.line : result.value < leg.quote.line) ? "win" : "loss";
}

export function marketFor(leg: Leg, board: Board): Market | undefined {
  return board.markets.find((market) => market.id === leg.id && market.eventId === leg.eventId &&
    market.player.id === leg.player.id && market.metric === leg.metric &&
    market.side === leg.side);
}

export function currentQuote(market: Market, quote: Quote): Quote | undefined {
  const book = market.quotes.filter((offer) => offer.book === quote.book);
  if (quote.main) {
    const main = book.filter((offer) => offer.main);
    return main.length === 1 ? main[0] : undefined;
  }
  const sameLine = book.filter((offer) => offer.line === quote.line);
  return sameLine.length === 1 ? sameLine[0] : undefined;
}

export function quoteIsFresh(quote: Quote, board: Board, now: Date): boolean {
  if (board.snapshot.mode === "fixture") return true;
  const age = +now - Date.parse(quote.observedAt);
  return age >= 0 && age <= 15 * 60_000;
}

export function reviewSlip(slip: Slip, board: Board, now: Date) {
  return slip.legs.map((leg) => {
    const market = marketFor(leg, board);
    const quote = market ? currentQuote(market, leg.quote) : undefined;
    const state = !quote ? "unverified" : !quoteIsFresh(quote, board, now) ? "stale"
      : quote.line !== leg.quote.line ? "line_moved"
      : quote.price !== leg.quote.price ? "price_changed" : "unchanged";
    return { leg, quote, state, result: settle(leg, market), actual: market?.result?.value ?? null,
      resultAt: market?.result?.observedAt ?? null };
  });
}

export type SlipReview = ReturnType<typeof reviewSlip>;
export type Update = { id: string; kind: "line" | "price" | "availability" | "result"; text: string; observedAt: string };
export const watchKey = (leg: Leg) => JSON.stringify([leg.id, leg.quote.book, leg.quote.main ? "main" : leg.quote.line]);

export function reconcileWatch(account: Account, board: Board, now: Date): Account {
  const updates: Update[] = [];
  let changed = false;
  const watch = account.watch.map((watch) => {
    const market = marketFor(watch.leg, board);
    if (!market) return watch;
    const prior = watch.checkpoint;
    const name = market.player.name;
    const quote = currentQuote(market, prior.quote);
    const add = (kind: Update["kind"], change: string | number, text: string, observedAt: string) => {
      const id = JSON.stringify([watchKey(watch.leg), kind, change, observedAt]);
      updates.push({ id, kind, text, observedAt });
    };

    let checkpoint = prior;
    if (quote && quoteIsFresh(quote, board, now) && quote.observedAt > prior.quote.observedAt &&
      (quote.line !== prior.quote.line || quote.price !== prior.quote.price)) {
      checkpoint = { ...checkpoint, quote };
      if (watch.line && prior.quote.line !== quote.line) {
        add("line", quote.line, `${name} moved from ${prior.quote.line} to ${quote.line} at ${quote.book}.`, quote.observedAt);
      } else if (watch.price && prior.quote.line === quote.line && prior.quote.price !== quote.price) {
        add("price", quote.price, `${name} ${sideLabel[market.side].toLowerCase()} ${quote.line} price changed at ${quote.book}.`, quote.observedAt);
      }
    }
    const availability = market.availability;
    if (availability && availability.status !== "unknown" && availability.status !== prior.availability?.status &&
      availability.observedAt > (prior.availability?.observedAt ?? watch.leg.quote.observedAt)) {
      checkpoint = { ...checkpoint, availability };
      if (watch.availability) {
        add("availability", availability.status, `${name} is listed as ${availability.status}.`, availability.observedAt);
      }
    }
    const result = market.result;
    if (result && result.observedAt > (prior.result?.observedAt ?? watch.leg.quote.observedAt) &&
      (result.state !== prior.result?.state || result.value !== prior.result?.value)) {
      checkpoint = { ...checkpoint, result };
      const settlement = settle(watch.leg, market);
      if (watch.result && ["win", "loss", "push", "void"].includes(settlement)) {
        add("result", `${settlement}:${result.value}`, `${name} result · ${settlement}.`, result.observedAt);
      }
    }
    if (checkpoint === prior) return watch;
    changed = true;
    return { ...watch, checkpoint };
  });
  if (!changed) return account;
  return { ...account, watch, updates: [...updates, ...account.updates]
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, 150) };
}

export function quietHours(preferences: Preferences, now: Date): boolean {
  if (preferences.quietStart === preferences.quietEnd) return false;
  const hour = Number(new Intl.DateTimeFormat("en", {
    timeZone: preferences.timeZone, hour: "numeric", hourCycle: "h23",
  }).format(now));
  return preferences.quietStart < preferences.quietEnd
    ? hour >= preferences.quietStart && hour < preferences.quietEnd
    : hour >= preferences.quietStart || hour < preferences.quietEnd;
}

export function isMetric(value: unknown): value is Metric {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(metrics, value);
}
export const validLine = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 200;
export const validPrice = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && Math.abs(value) >= 100 && Math.abs(value) <= 100_000;
export const stamp = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const shortText = (value: unknown, max = 100): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

function validQuote(value: unknown): value is Quote {
  return isRecord(value) && shortText(value.book) && validLine(value.line) &&
    validPrice(value.price) && stamp(value.observedAt) && typeof value.main === "boolean";
}

function validMarket(value: unknown, asOf: string): value is Market {
  if (!isRecord(value) || !shortText(value.id) || !shortText(value.eventId) || !isDate(value.date) ||
    !shortText(value.matchup) || !isRecord(value.player) || !isPlayerId(value.player.id) ||
    !shortText(value.player.name) || typeof value.player.team !== "string" || !/^[A-Z]{2,4}$/.test(value.player.team) ||
    value.player.sport !== "NBA" || !isMetric(value.metric) ||
    !["over", "under", "at_least"].includes(String(value.side))) return false;
  for (const quotes of [value.quotes, value.previousQuotes]) {
    if (!Array.isArray(quotes) || quotes.length > 100 ||
      !quotes.every((quote) => validQuote(quote) && quote.observedAt <= asOf) ||
      new Set(quotes.map((quote) => JSON.stringify([quote.book, quote.line]))).size !== quotes.length ||
      new Set(quotes.filter((quote) => quote.main).map((quote) => quote.book)).size !== quotes.filter((quote) => quote.main).length) return false;
  }
  const score = value.score;
  if (score !== null && (!isRecord(score) || !validLine(score.value) || score.value > 100 ||
    !stamp(score.asOf) || score.asOf > asOf || !Array.isArray(score.factors) || score.factors.length > 12 ||
    !score.factors.every((f) => isRecord(f) && shortText(f.label) &&
      typeof f.contribution === "number" && Number.isFinite(f.contribution) && Math.abs(f.contribution) <= 100) ||
    !Array.isArray(score.missing) || score.missing.length > 12 || !score.missing.every((label) => shortText(label)))) return false;
  const availability = value.availability;
  if (availability !== null && (!isRecord(availability) ||
    !["available", "questionable", "out", "unknown"].includes(String(availability.status)) ||
    !stamp(availability.observedAt) || availability.observedAt > asOf)) return false;
  const result = value.result;
  return result === null || (isRecord(result) && ["pending", "postponed", "void", "final"].includes(String(result.state)) &&
    (result.state === "final" ? Number.isSafeInteger(result.value) && Number(result.value) >= 0 : result.value === null) &&
    stamp(result.observedAt) && result.observedAt <= asOf);
}

export function validBoard(value: unknown): value is Board {
  if (!isRecord(value) || !stamp(value.asOf) || !isRecord(value.snapshot) || !Array.isArray(value.markets) ||
    value.markets.length > 500) return false;
  const { snapshot, asOf, markets } = value;
  return shortText(snapshot.dataset) && shortText(snapshot.revision) && shortText(snapshot.source) &&
    stamp(snapshot.snapshotAt) && snapshot.snapshotAt <= asOf && isDate(snapshot.coverageThrough) &&
    (snapshot.mode === "fixture" ? snapshot.fetchedAt === null :
      snapshot.mode === "verified" && stamp(snapshot.fetchedAt) && snapshot.fetchedAt <= asOf) &&
    markets.every((market) => validMarket(market, asOf)) &&
    new Set(markets.map((market) => market.id)).size === markets.length &&
    new Set(markets.map((market) => JSON.stringify([market.eventId, market.player.id, market.metric, market.side]))).size === markets.length;
}

export type WorkflowView = {
  board: Board;
  slips: { id: string; name: string; createdAt: string; legs: ReturnType<typeof reviewSlip> }[];
  watch: Watch[];
  updates: Update[];
  read: string[];
  preferences: Preferences;
  pushPublicKey: string | null;
  pushEnabled: boolean;
};
