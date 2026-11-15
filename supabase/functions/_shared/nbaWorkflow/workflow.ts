import { calculate } from "../analyticsAssistant/calculate.ts";
import { isRecord, type Query } from "../analyticsAssistant/contract.ts";
import type { Source, Store } from "./store.ts";
import {
  isMetric, quoteIsFresh, reviewSlip, shortText, stamp, validLine, validPrice, watchKey, reconcileWatch,
  type Account, type Board, type Leg, type Market, type Preferences, type Research, type ResearchPlan,
  type Selection, type Subscription, type Watch, type WorkflowView,
} from "./domain.ts";
import { rulesPlan } from "./planner.ts";

export class WorkflowError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function view(board: Board, account: Account, now: Date, pushPublicKey: string | undefined): WorkflowView {
  return {
    board, slips: account.slips.map((slip) => ({
      id: slip.id, name: slip.name, createdAt: slip.createdAt, legs: reviewSlip(slip, board, now),
    })), watch: account.watch, updates: account.updates, read: account.read,
    preferences: account.preferences, pushPublicKey: pushPublicKey ?? null, pushEnabled: account.subscription !== null,
  };
}

const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

function validSelection(value: unknown): value is Selection {
  return isRecord(value) && shortText(value.marketId) && shortText(value.book) && validLine(value.line) &&
    validPrice(value.price) && stamp(value.observedAt);
}

function resolveLeg(board: Board, input: unknown, now: Date): Leg {
  if (!validSelection(input)) throw new WorkflowError(400, "Choose a displayed quote for each leg.");
  const market = board.markets.find((row) => row.id === input.marketId);
  const quote = market?.quotes.find((row) => row.book === input.book && row.line === input.line &&
    row.price === input.price && row.observedAt === input.observedAt);
  if (!market || !quote || !quoteIsFresh(quote, board, now)) {
    throw new WorkflowError(409, "The selected quote changed or expired. Refresh the board and select it again.");
  }
  const { id, eventId, date, player, metric, side } = market;
  return { id, eventId, date, player, metric, side, quote };
}

function validPreferences(value: unknown): value is Preferences {
  if (!isRecord(value) || typeof value.enabled !== "boolean" ||
    ![value.quietStart, value.quietEnd].every((hour) => Number.isInteger(hour) && Number(hour) >= 0 && Number(hour) < 24) ||
    !shortText(value.timeZone, 80)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timeZone });
    return true;
  } catch {
    return false;
  }
}

export function validSubscription(value: unknown): value is Subscription {
  if (!isRecord(value) || !shortText(value.endpoint, 2048) || !isRecord(value.keys) ||
    typeof value.keys.p256dh !== "string" || !/^[\w-]{87}$/.test(value.keys.p256dh) ||
    typeof value.keys.auth !== "string" || !/^[\w-]{22}$/.test(value.keys.auth)) return false;
  try {
    const url = new URL(value.endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.search) return false;
    if (url.hostname === "fcm.googleapis.com") return /^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:-]+$/.test(url.pathname);
    if (url.hostname === "updates.push.services.mozilla.com") return /^\/wpush\/v[12]\/[A-Za-z0-9_-]+$/.test(url.pathname);
    return url.hostname === "web.push.apple.com" && /^\/[A-Za-z0-9_/-]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

function makeQuery(market: Market, plan: ResearchPlan, cutoff: string): Query {
  return {
    sport: "NBA", playerId: market.player.id, metric: plan.metric, asOf: cutoff, window: plan.window,
    operation: { kind: "count", comparator: plan.side === "over" ? "gt" : plan.side === "under" ? "lt" : "gte",
      threshold: plan.line },
  };
}

export type Planner = (userId: string, question: string, defaults: ResearchPlan, signal: AbortSignal) =>
  Promise<ResearchPlan | undefined>;

export function createWorkflow(options: {
  store: Store; source: (signal: AbortSignal) => Source | undefined | Promise<Source | undefined>; plan?: Planner;
  pushPublicKey?: string; advance?: () => void;
}) {
  return async (input: unknown, userId: string, now: Date, signal: AbortSignal, isAdmin: () => Promise<boolean>) => {
    if (!isRecord(input) || typeof input.action !== "string") throw new WorkflowError(400, "Invalid research request.");
    if (input.action === "advance") {
      if (!options.advance) throw new WorkflowError(404, "Fixture controls are unavailable.");
      options.advance();
    }
    const source = await options.source(signal);
    if (!source) throw new WorkflowError(503, "There is no verified NBA snapshot available.");
    const { board } = source;
    const { store } = options;
    const update = (change: (account: Account) => Account) => store.update(userId,
      (account) => change(reconcileWatch(account, board, now)), signal);

    switch (input.action) {
      case "load":
      case "advance":
        return view(board, await update((account) => account), now, options.pushPublicKey);
      case "diagnostics": {
        if (!await isAdmin()) throw new WorkflowError(403, "Admin access is required.");
        return {
          source: board.snapshot, asOf: board.asOf, markets: board.markets.length,
          quotes: board.markets.reduce((sum, row) => sum + row.quotes.length, 0),
          freshQuotes: board.markets.reduce((sum, row) => sum + row.quotes.filter((quote) => quoteIsFresh(quote, board, now)).length, 0),
          scoringCoverage: board.markets.filter((row) => row.score !== null).length,
          availabilityCoverage: board.markets.filter((row) => row.availability !== null).length,
          finalMarkets: board.markets.filter((row) => row.result?.state === "final").length,
          modelConfigured: !!options.plan, pushConfigured: !!options.pushPublicKey,
          feedback: await store.feedback(signal),
        };
      }
      case "research": {
        const market = board.markets.find((row) => row.id === input.marketId);
        if (!market) throw new WorkflowError(404, "This exact market is absent from the NBA snapshot.");
        const defaultLine = input.line ?? market.quotes[0]?.line ?? market.previousQuotes[0]?.line;
        const window = input.window ?? 5;
        const side = input.side ?? market.side;
        const metric = input.metric ?? market.metric;
        if (!validLine(defaultLine) || !isMetric(metric) || (window !== 5 && window !== 10) ||
          (side !== "over" && side !== "under" && side !== "at_least")) {
          throw new WorkflowError(400, "Select a valid stat, line and appearance window.");
        }
        const defaults: ResearchPlan = { line: defaultLine, metric, window, side, tools: ["game_logs", "scores", "quotes", "availability"] };
        let plan: ResearchPlan | undefined = defaults;
        let planner: Research["planner"] = "rules";
        if (input.question !== undefined) {
          if (!shortText(input.question, 240)) throw new WorkflowError(400, "Enter a single research question of up to 240 characters.");
          const modelPlan = await options.plan?.(userId, input.question, defaults, signal).catch(() => undefined);
          if (modelPlan) {
            planner = "google";
            plan = modelPlan;
          } else {
            plan = rulesPlan(input.question, defaults);
          }
          if (!plan) throw new WorkflowError(422, "Ask about game logs, the score, the quotes or player availability for this prop.");
        }
        const result: Research = { planner, plan };
        if (plan.tools.includes("game_logs")) {
          // Count games strictly before the market date so a finalized prop never backfills its own pregame context.
          const previousDate = new Date(Date.parse(market.date + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
          result.evidence = await calculate(source.logs, makeQuery(market, plan, previousDate), market.player, now, signal);
        }
        if (plan.tools.includes("scores")) result.score = market.score;
        if (plan.tools.includes("quotes")) result.quotes = { current: market.quotes, previous: market.previousQuotes };
        if (plan.tools.includes("availability")) result.availability = market.availability;
        return result;
      }
      case "save": {
        if (!uuid(input.id) || !shortText(input.name, 80) || !Array.isArray(input.legs) ||
          input.legs.length < 1 || input.legs.length > 8) throw new WorkflowError(400, "Name the slip and choose one to eight legs.");
        const id = input.id;
        const name = input.name.trim();
        const existing = (await store.load(userId, signal)).slips.find((slip) => slip.id === id);
        if (existing) return view(board, await update((account) => account), now, options.pushPublicKey);
        const legs = input.legs.map((leg) => resolveLeg(board, leg, now));
        if (new Set(legs.map((leg) => JSON.stringify([leg.id, leg.quote.line]))).size !== legs.length) {
          throw new WorkflowError(400, "Remove duplicate legs.");
        }
        return view(board, await update((account) => {
          if (account.slips.some((slip) => slip.id === id)) return account;
          if (account.slips.length >= 30) throw new WorkflowError(409, "Remove a saved slip before adding another.");
          return { ...account, slips: [{ id, name, legs, createdAt: now.toISOString() }, ...account.slips] };
        }), now, options.pushPublicKey);
      }
      case "remove":
        if (!uuid(input.id)) throw new WorkflowError(400, "Invalid saved slip.");
        return view(board, await update((account) => ({
          ...account, slips: account.slips.filter((slip) => slip.id !== input.id),
        })), now, options.pushPublicKey);
      case "watch": {
        const leg = resolveLeg(board, input.leg, now);
        const types = input.types;
        if (!isRecord(types) || !["line", "price", "availability", "result"].every((key) => typeof types[key] === "boolean") ||
          !["line", "price", "availability", "result"].some((key) => types[key] === true)) {
          throw new WorkflowError(400, "Choose at least one type of update.");
        }
        const market = board.markets.find((row) => row.id === leg.id);
        const rule: Watch = {
          leg, line: types.line === true, price: types.price === true, availability: types.availability === true,
          result: types.result === true, checkpoint: {
            quote: leg.quote, availability: market?.availability ?? null, result: market?.result ?? null,
          },
        };
        return view(board, await update((account) => {
          const existing = account.watch.find((item) => watchKey(item.leg) === watchKey(leg));
          const other = account.watch.filter((item) => watchKey(item.leg) !== watchKey(leg));
          if (other.length >= 20) throw new WorkflowError(409, "Remove a followed market before adding another.");
          return { ...account, watch: [...other, {
            ...rule, leg: existing?.leg ?? leg, checkpoint: existing?.checkpoint ?? rule.checkpoint,
          }] };
        }), now, options.pushPublicKey);
      }
      case "unwatch":
        if (!shortText(input.key, 512)) throw new WorkflowError(400, "Invalid followed market.");
        return view(board, await update((account) => ({
          ...account, watch: account.watch.filter((item) => watchKey(item.leg) !== input.key),
        })), now, options.pushPublicKey);
      case "preferences": {
        if (!validPreferences(input.preferences)) throw new WorkflowError(400, "Enter valid alert preferences.");
        const { enabled, quietStart, quietEnd, timeZone } = input.preferences;
        return view(board, await update((account) => ({
          ...account, preferences: { enabled, quietStart, quietEnd, timeZone },
        })), now, options.pushPublicKey);
      }
      case "read":
        return view(board, await update((account) => ({
          ...account, read: [...new Set([...account.updates.map((event) => event.id), ...account.read])].slice(0, 150),
        })), now, options.pushPublicKey);
      case "push": {
        const subscription = input.subscription;
        if (subscription !== null && (!options.pushPublicKey || !validSubscription(subscription))) {
          throw new WorkflowError(400, "The browser push service is unavailable or unsupported.");
        }
        return view(board, await update((account) => ({
          ...account, subscription: subscription === null ? null : { endpoint: subscription.endpoint, keys: {
            p256dh: subscription.keys.p256dh, auth: subscription.keys.auth,
          } },
        })), now, options.pushPublicKey);
      }
      case "report":
        if (!uuid(input.reference) || !["data", "match", "answer"].includes(String(input.reason))) {
          throw new WorkflowError(400, "Choose a feedback category.");
        }
        await store.report(userId, input.reference, String(input.reason), signal);
        return { reported: true };
      default:
        throw new WorkflowError(400, "Unknown research request.");
    }
  };
}
