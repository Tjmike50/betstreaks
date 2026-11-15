import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { fixtureSource } from "../analyticsAssistant/fixtures.ts";
import { advanceFixture, fixtureBoard } from "./fixtures.ts";
import { quietHours, selectionFor, settle, validBoard, type Board, type Research, type ResearchPlan, type WorkflowView } from "./domain.ts";
import { createWorkflowHandler } from "./handler.ts";
import { googlePlan, rulesPlan } from "./planner.ts";
import { memoryStore, verifiedSource } from "./store.ts";
import { createWorkflow, validSubscription } from "./workflow.ts";

const date = new Date("2026-11-10T23:50:00.000Z");
const origin = "http://127.0.0.1:47961";

function setup(options: { includeModel?: boolean } = {}) {
  let board = fixtureBoard;
  const store = memoryStore();
  const workflow = createWorkflow({
    store,
    source: () => ({ board, logs: fixtureSource }),
    advance: () => { board = advanceFixture(fixtureBoard); },
    plan: options.includeModel ? (_id, _question, defaults) => Promise.resolve({
      ...defaults, tools: ["game_logs", "quotes"],
    }) : undefined,
  });
  const handler = createWorkflowHandler({
    authenticate: (req) => {
      const id = req.headers.get("authorization")?.replace(/^Bearer /, "");
      return Promise.resolve(id && ["A", "B"].includes(id) ? { ok: true, status: 200, userId: id } : { ok: false, status: 401 });
    },
    isAdmin: (req) => Promise.resolve(req.headers.get("authorization") === "Bearer B"),
    origins: [origin], workflow, now: () => date,
  });
  const call = async <T>(input: object, user = "A", requestOrigin = origin) => {
    const response = await handler(new Request(origin, {
      method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json", Authorization: `Bearer ${user}` },
      body: JSON.stringify(input),
    }));
    const body = await response.json();
    return { status: response.status, data: body.data as T, error: body.error, reference: body.reference };
  };
  return { call, store };
}

Deno.test("research pins pregame dates and distinguishes ties from milestones", async () => {
  const { call } = setup();
  const avery = await call<Research>({ action: "research", marketId: "fixture-avery-pts", line: 20 });
  assertEquals(avery.status, 200);
  const answer = avery.data.evidence;
  assert(answer?.status === "answer");
  assertEquals(answer.query.asOf, "2026-11-09");
  assertEquals(answer.calculation, { kind: "count", comparator: "gt", threshold: 20, hits: 1, denominator: 5, ties: 2, pushes: 2 });
  assertEquals(avery.data.score?.missing, ["Verified minutes"]);
  const jordan = await call<Research>({ action: "research", marketId: "fixture-jordan-ast" });
  const milestone = jordan.data.evidence;
  assert(milestone?.status === "answer");
  assertEquals(milestone.calculation, { kind: "count", comparator: "gte", threshold: 4, hits: 3, denominator: 5, ties: 1, pushes: 0 });
});

Deno.test("slips keep historical quotes, reject duplicates and stale choices, and isolate users", async () => {
  const { call } = setup();
  const id = crypto.randomUUID();
  const first = fixtureBoard.markets[0];
  const closed = fixtureBoard.markets[2];
  const legs = [selectionFor(first, first.quotes[0]), selectionFor(closed, closed.quotes[0])];
  const input = { action: "save", id, name: "NBA market review", legs };
  const [saved, retried] = await Promise.all([call<WorkflowView>(input), call<WorkflowView>(input)]);
  assertEquals(saved.data.slips.length, 1);
  assertEquals(retried.data.slips.length, 1);
  assertEquals(saved.data.slips[0].legs[1].result, "push");
  assertEquals((await call<WorkflowView>({ action: "load" }, "B")).data.slips.length, 0);
  assertEquals((await call({ ...input, id: crypto.randomUUID(), legs: [legs[0], legs[0]] })).status, 400);
  const advanced = await call<WorkflowView>({ action: "advance" });
  assertEquals(advanced.data.slips[0].legs[0].leg.quote.line, 20.5);
  assertEquals(advanced.data.slips[0].legs[0].quote?.line, 21.5);
  assertEquals(advanced.data.slips[0].legs[0].state, "line_moved");
  assertEquals(advanced.data.slips[0].legs[0].result, "loss");
  assertEquals((await call({ ...input, id: crypto.randomUUID() })).status, 409);
});

Deno.test("advanced results and prices become persistent, deduplicated account updates", async () => {
  const { call } = setup();
  const first = fixtureBoard.markets[0];
  const averySouth = selectionFor(first, first.quotes[2]);
  const jordan = fixtureBoard.markets[1];
  const options = { line: true, price: true, availability: true, result: true };
  await call({ action: "watch", leg: averySouth, types: options });
  await call({ action: "watch", leg: selectionFor(jordan, jordan.quotes[0]), types: options });
  const initial = await call<WorkflowView>({ action: "load" });
  assertEquals(initial.data.updates.length, 0);
  const advanced = await call<WorkflowView>({ action: "advance" });
  assertEquals(advanced.data.updates.map((event) => event.kind).sort(), ["availability", "price", "result", "result"]);
  assert(advanced.data.updates.some((event) => event.text.includes("void")));
  const read = await call<WorkflowView>({ action: "read" });
  const reloaded = await call<WorkflowView>({ action: "load" });
  assertEquals(read.data.read.length, 4);
  assertEquals(reloaded.data.updates, advanced.data.updates);
  assertEquals(reloaded.data.read, read.data.read);
});

Deno.test("settlement handles rescheduling and voids without inventing totals", () => {
  const market = fixtureBoard.markets[0];
  const leg = { ...market, quote: market.quotes[0] };
  assertEquals(settle(leg, undefined), "unverified");
  assertEquals(settle(leg, { ...market, result: { state: "postponed", value: null, observedAt: "" } }), "postponed");
  assertEquals(settle(leg, { ...market, result: { state: "void", value: null, observedAt: "" } }), "void");
  assertEquals(settle(leg, { ...market, result: { state: "final", value: null, observedAt: "" } }), "unverified");
});

Deno.test("Gemini plans are bounded and facts are returned by read-only tools", async () => {
  const defaults: ResearchPlan = { tools: ["game_logs"], line: 20.5, metric: "PTS", window: 5, side: "over" };
  const plan = rulesPlan("How many times under 20 points in the last 10 games?", defaults);
  assertEquals(plan, { ...defaults, line: 20, side: "under", window: 10 });
  assertEquals(rulesPlan("hello", defaults), undefined);
  let payload: unknown;
  const routed = await googlePlan({
    key: "fixture-key", model: "google/gemini-test", question: "Why did the price change?", defaults,
    signal: new AbortController().signal,
    fetcher: (url, init) => {
      assertEquals(String(url), "https://ai.gateway.lovable.dev/v1/chat/completions");
      payload = JSON.parse(String(init?.body));
      return Promise.resolve(Response.json({ choices: [{ message: { content: JSON.stringify({
        tools: ["quotes", "scores"], quote: "invented", additional: true,
      }) } }] }));
    },
  });
  assertEquals((payload as { model: string }).model, "google/gemini-test");
  assertEquals(routed, { ...defaults, tools: ["quotes", "scores"] });

  const { call } = setup({ includeModel: true });
  const actual = await call<Research>({ action: "research", marketId: "fixture-avery-pts", question: "Can you show the data?" });
  assertEquals(actual.data.planner, "google");
  assertEquals(actual.data.quotes?.current, fixtureBoard.markets[0].quotes);
  assertEquals(actual.data.score, undefined);
});

Deno.test("verified inputs validate exact board identity and exclude stale or incomplete evidence", async () => {
  assert(validBoard(fixtureBoard));
  assert(validBoard(advanceFixture(fixtureBoard)));
  assertEquals(validBoard({ ...fixtureBoard, markets: [fixtureBoard.markets[0], fixtureBoard.markets[0]] }), false);
  const board: Board = {
    ...fixtureBoard,
    snapshot: { ...fixtureBoard.snapshot, mode: "verified", fetchedAt: fixtureBoard.asOf },
  };
  assertEquals(verifiedSource({ board: fixtureBoard, appearances: [], completePlayerIds: [] }, date), undefined);
  const source = verifiedSource({ board, appearances: [], completePlayerIds: [] }, date);
  assert(source);
  const workflow = createWorkflow({ store: memoryStore(), source: () => source });
  const input = { action: "research", marketId: "fixture-avery-pts" };
  const result = await workflow(input, "A", date, new AbortController().signal, () => Promise.resolve(false)) as Research;
  assert(result.evidence?.status === "error");
  assertEquals(result.evidence.code, "DATA_UNVERIFIED");
  const view = await workflow({ action: "load" }, "A", date, new AbortController().signal, () => Promise.resolve(false)) as WorkflowView;
  assertEquals(view.board.snapshot.mode, "verified");
});

Deno.test("authentication, admin gating, bounded input and user push settings", async () => {
  const { call } = setup();
  assertEquals((await call({ action: "load" }, "invalid")).status, 401);
  assertEquals((await call({ action: "load" }, "A", "https://unrelated.example")).status, 403);
  assertEquals((await call({ action: "load", excess: "a".repeat(18000) })).status, 413);
  assertEquals((await call({ action: "diagnostics" }, "A")).status, 403);
  assertEquals((await call({ action: "diagnostics" }, "B")).status, 200);
  assertEquals(quietHours({ enabled: true, quietStart: 22, quietEnd: 8, timeZone: "America/Indianapolis" }, new Date("2026-11-11T04:00:00Z")), true);
  assertEquals(validSubscription({ endpoint: "https://localhost/fake", keys: { p256dh: "a".repeat(87), auth: "a".repeat(22) } }), false);
});
