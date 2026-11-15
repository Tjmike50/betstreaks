import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { Reply } from "../../../supabase/functions/_shared/analyticsAssistant/contract";
import AnalyticsAssistantPage from "./AnalyticsAssistantPage";

const mocks = vi.hoisted(() => ({
  auth: { user: { id: "first-user" } as { id: string } | null, isLoading: false },
  sport: { sport: "NBA", setSport: vi.fn() },
  invoke: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/contexts/SportContext", () => ({ useSport: () => mocks.sport }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

const average: Reply = {
  status: "answer",
  correlationId: "fixture-request",
  context: "signed.context",
  player: { id: 1001, name: "Avery Stone", team: "BOS", sport: "NBA" },
  query: { sport: "NBA", playerId: 1001, window: 5, metric: "PTS", operation: { kind: "average" }, asOf: "2026-11-10" },
  coverage: { requested: 5, appearances: 5, known: 5, missing: 0 },
  evidence: [10, 20, 30, 20, 15].map((value, i) => ({ date: "2026-11-09", gameId: `fixture-${i}`, value })),
  provenance: {
    dataset: "Synthetic game logs", source: "Hand-authored fixtures", revision: "nba-fixtures-v1",
    mode: "fixture", freshness: "frozen_fixture", coverageThrough: "2026-11-10",
    latestGameDate: "2026-11-09", snapshotAt: "2026-11-10T12:00:00Z",
    fetchedAt: null, computedAt: "2026-11-10T13:00:00Z",
  },
  calculation: { kind: "average", sum: 95, denominator: 5, value: 19 },
};

const page = () => <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
  <AnalyticsAssistantPage />
</MemoryRouter>;

function askExample() {
  fireEvent.click(screen.getByRole("button", { name: "Average points" }));
}

beforeEach(() => {
  mocks.auth.user = { id: "first-user" };
  mocks.sport.sport = "NBA";
  mocks.invoke.mockReset().mockResolvedValue({ data: average });
});
afterEach(cleanup);

describe("Analytics Assistant Research page", () => {
  it("offers the authenticated return route without making requests for a signed-out user", () => {
    mocks.auth.user = null;
    render(page());
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth?next=analytics");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("renders the exact calculation, evidence and source, then uses server context for a follow-up", async () => {
    render(page());
    askExample();
    expect(await screen.findByText(/95 ÷ 5 = 19/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Selected appearance evidence" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Source and dates" })).toHaveTextContent("Frozen synthetic snapshot");
    fireEvent.click(screen.getByRole("button", { name: "What about rebounds?" }));
    expect(mocks.invoke).toHaveBeenLastCalledWith("ai-analytics-assistant", expect.objectContaining({
      body: expect.objectContaining({ question: "What about rebounds?", context: "signed.context" }),
    }));
    await screen.findByText(/95 ÷ 5 = 19/);
  });

  it("returns an offered player ID and the signed clarification", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: {
        status: "clarification", code: "AMBIGUOUS_PLAYER", correlationId: "fixture-request", context: "signed.choice",
        choices: [
          { id: 1002, name: "Jordan Reed", team: "BOS", sport: "NBA" },
          { id: 1003, name: "Jordan Reed", team: "NYK", sport: "NBA" },
        ],
      },
    });
    render(page());
    fireEvent.click(screen.getByRole("button", { name: "Ambiguous player" }));
    fireEvent.click(await screen.findByRole("button", { name: "Jordan Reed · NYK" }));
    expect(mocks.invoke).toHaveBeenLastCalledWith("ai-analytics-assistant", expect.objectContaining({
      body: expect.objectContaining({ kind: "select", playerId: 1003, context: "signed.choice" }),
    }));
    await screen.findByRole("region", { name: "Analytics result" });
  });

  it("discards the answer and context across account and sport changes", async () => {
    const { rerender } = render(page());
    askExample();
    await screen.findByText(/95 ÷ 5 = 19/);
    mocks.auth.user = { id: "second-user" };
    rerender(page());
    expect(screen.queryByText(/95 ÷ 5 = 19/)).toBeNull();
    expect(screen.queryByRole("button", { name: "What about rebounds?" })).toBeNull();
    askExample();
    expect(mocks.invoke.mock.lastCall?.[1].body.context).toBeUndefined();
    await screen.findByText(/95 ÷ 5 = 19/);
    mocks.sport.sport = "MLB";
    rerender(page());
    expect(screen.getByRole("button", { name: "Switch to NBA" })).toBeInTheDocument();
    mocks.sport.sport = "NBA";
    rerender(page());
    expect(screen.queryByText(/95 ÷ 5 = 19/)).toBeNull();
  });

  it("aborts a pending request and discards its late response on an account switch", async () => {
    let resolve: (value: { data: Reply }) => void = () => {};
    mocks.invoke.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { rerender } = render(page());
    askExample();
    const signal = mocks.invoke.mock.lastCall?.[1].signal as AbortSignal;
    mocks.auth.user = { id: "second-user" };
    rerender(page());
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve({ data: average }); });
    expect(screen.queryByText(/95 ÷ 5 = 19/)).toBeNull();
    expect(screen.queryByRole("button", { name: "What about rebounds?" })).toBeNull();
  });

  it("renders the structured source error and keeps malformed output from rendering a number", async () => {
    const body = { status: "error", code: "SOURCE_UNAVAILABLE", correlationId: "fixture-error" };
    mocks.invoke.mockResolvedValueOnce({ error: new FunctionsHttpError({ json: async () => body }) });
    render(page());
    askExample();
    expect(await screen.findByRole("alert")).toHaveTextContent("The game-log source is unavailable.");
    expect(screen.getByText("Request ID fixture-error")).toBeInTheDocument();
    mocks.invoke.mockResolvedValueOnce({ data: { ...average, calculation: { kind: "average", value: "fake result" } } });
    askExample();
    expect(await screen.findByRole("alert")).toHaveTextContent("The game-log source is unavailable.");
    expect(screen.queryByText("fake result")).toBeNull();
  });
});
