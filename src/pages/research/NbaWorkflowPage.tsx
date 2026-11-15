import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/useAdmin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResearchEvidence } from "@/components/nba-workflow/ResearchEvidence";
import { ResearchSlips } from "@/components/nba-workflow/ResearchSlips";
import { ResearchWatchlist } from "@/components/nba-workflow/ResearchWatchlist";
import { callWorkflow, formatPrice, formatStamp, marketLabel, nbaFixtureControls, parseMetric, type ImportedLeg } from "@/components/nba-workflow/client";
import { metrics } from "../../../supabase/functions/_shared/analyticsAssistant/contract";
import { quoteIsFresh, selectionFor, sideLabel, type Market, type Research, type Selection, type WorkflowView } from "../../../supabase/functions/_shared/nbaWorkflow/domain";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const tabs = ["research", "slips", "watchlist", "ask"];

function ResearchForm({ market, ask, initialLine }: { market: Market; ask: boolean; initialLine?: number }) {
  const [line, setLine] = useState(String(initialLine ?? market.quotes[0]?.line ?? market.previousQuotes[0]?.line ?? 0));
  const [window, setWindow] = useState<5 | 10>(5);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<{ data: Research; reference: string }>();
  const [context, setContext] = useState<Research["plan"]>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState(false);
  const prefix = ask ? "ask" : "compare";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setFeedback(false);
    setResult(undefined);
    try {
      const reply = await callWorkflow<Research>({
        action: "research", marketId: market.id, line: Number(line), window,
        ...(ask ? {
          question: question.trim(),
          ...(context ? { line: context.line, window: context.window, metric: context.metric, side: context.side } : {}),
        } : {}),
      });
      setResult(reply);
      if (ask) setContext(reply.data.plan);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Research is unavailable.");
    } finally {
      setPending(false);
    }
  }

  const sendFeedback = async () => {
    if (!result) return;
    setPending(true);
    try {
      await callWorkflow({ action: "report", reference: result.reference, reason: "data" });
      setFeedback(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Feedback could not be saved.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="font-semibold">{ask ? "Ask BetStreaks" : "Explain this line"}</h2>
            <p className="text-sm text-muted-foreground">
              {market.player.name} · {market.matchup} · {market.date}
            </p>
          </div>
          <form className="space-y-3" onSubmit={submit}>
            {ask ? (
              <label className="block text-sm font-medium" htmlFor="nba-question">Question
                <Input id="nba-question" maxLength={240} value={question} onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Why is this ranked, and did the price move?" required />
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm" htmlFor={`${prefix}-line`}>{sideLabel[market.side]} · {metrics[market.metric].label}
                  <Input id={`${prefix}-line`} type="number" min={0} max={200} step="any" required value={line}
                    onChange={(event) => setLine(event.target.value)} />
                </label>
                <label className="text-sm" htmlFor={`${prefix}-window`}>Appearances
                  <select id={`${prefix}-window`} className={selectClass} value={window}
                    onChange={(event) => setWindow(Number(event.target.value) === 10 ? 10 : 5)}>
                    <option value={5}>Last 5</option><option value={10}>Last 10</option>
                  </select>
                </label>
              </div>
            )}
            <Button disabled={pending || (ask && !question.trim())} type="submit">
              {pending ? "Checking…" : ask ? "Ask" : "Show evidence"}
            </Button>
          </form>
        </CardContent>
      </Card>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {result && (
        <div className="space-y-3" aria-live="polite">
          {ask && <Badge variant="outline">{result.data.planner === "google" ? "Google Gemini routed this question" : "Research rules routed this question"}</Badge>}
          <ResearchEvidence result={result.data} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={feedback || pending} onClick={() => void sendFeedback()}>
              {feedback ? "Data issue reported" : "Report a data issue"}
            </Button>
            <span className="break-all text-xs text-muted-foreground">Reference {result.reference}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Workflow({ userId }: { userId: string }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { isAdmin } = useAdmin();
  const client = useQueryClient();
  const queryKey = ["nba-research-workflow", userId];
  const { data: view, isPending, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => (await callWorkflow<WorkflowView>({ action: "load" })).data,
    retry: false,
  });
  const [draft, setDraft] = useState<Selection[]>([]);
  const [selectedBook, setSelectedBook] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const rawTab = params.get("tab") ?? "";
  const tab = tabs.includes(rawTab) ? rawTab : "research";
  const markets = view?.board.markets ?? [];
  const marketId = params.get("market");
  const playerId = params.get("player");
  const stat = parseMetric(params.get("stat") ?? "");
  const lineText = params.get("line");
  const exactLine = lineText !== null && /^\d+(?:\.\d+)?$/.test(lineText) ? Number(lineText) : undefined;
  const seeded = markets.filter((item) => playerId !== null && item.player.id === Number(playerId) &&
    item.metric === stat && item.date === params.get("date") && item.side === "over" && item.quotes.some((quote) => quote.line === exactLine));
  const market = marketId ? markets.find((item) => item.id === marketId)
    : playerId ? seeded.length === 1 ? seeded[0] : undefined : markets[0];
  const quote = market?.quotes.find((offer) => JSON.stringify([offer.book, offer.line]) === selectedBook)
    ?? market?.quotes.find((offer) => offer.line === exactLine) ?? market?.quotes[0];
  const imported = (location.state as { nbaImport?: ImportedLeg[] } | null)?.nbaImport;

  const selectTab = (value: string) => {
    setParams((prior) => {
      const next = new URLSearchParams(prior);
      next.set("tab", value);
      return next;
    }, { replace: true, state: location.state });
  };

  async function mutate(body: object) {
    setBusy(true);
    setProblem("");
    try {
      const { data } = await callWorkflow<WorkflowView>(body);
      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, data);
      return true;
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The requested update could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return <div className="mx-auto max-w-4xl p-5">
      {isPending ? <p role="status">Loading NBA research…</p> : <>
        <p role="alert" className="mb-3 text-destructive">{error instanceof Error ? error.message : "NBA research is unavailable."}</p>
        <Button onClick={() => void refetch()}>Retry</Button>
      </>}
    </div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 pb-24 pt-5 md:px-6">
      <Link className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" to="/research">
        <ArrowLeft className="h-4 w-4" /> Research
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">NBA Research</h1>
            {view.board.snapshot.mode === "fixture" && <Badge variant="secondary">Fictional data</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">Snapshot {formatStamp(view.board.asOf)} · {view.board.snapshot.source}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy || isFetching} onClick={() => void refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh quotes &amp; results
          </Button>
          {nbaFixtureControls && view.board.snapshot.mode === "fixture" && view.board.snapshot.revision === "nba-fixtures-v1" && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void mutate({ action: "advance" })}>Advance demo slate</Button>
          )}
          {(nbaFixtureControls || isAdmin) && <Button asChild size="sm" variant="ghost"><Link to="/admin/nba-research">Diagnostics</Link></Button>}
        </div>
      </header>

      {(problem || error) && <p role="alert" className="text-sm text-destructive">{problem || error?.message}</p>}
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="grid h-auto w-full grid-cols-4">
          <TabsTrigger className="px-1.5 text-xs sm:text-sm" value="research">Research</TabsTrigger>
          <TabsTrigger className="px-1.5 text-xs sm:text-sm" value="slips">Saved slips{draft.length > 0 ? ` (${draft.length})` : ""}</TabsTrigger>
          <TabsTrigger className="px-1.5 text-xs sm:text-sm" value="watchlist">Watchlist</TabsTrigger>
          <TabsTrigger className="px-1.5 text-xs sm:text-sm" value="ask">Ask</TabsTrigger>
        </TabsList>
        {tab !== "slips" && <div className="mt-4 space-y-1">
          <label htmlFor="nba-market" className="text-sm font-medium">Market</label>
          <select id="nba-market" className={selectClass} value={market?.id ?? ""} onChange={(event) => {
            const id = event.target.value;
            setSelectedBook("");
            setParams({ tab, market: id }, { replace: true, state: location.state });
          }}>
            {!market && <option value="">Select a verified market</option>}
            {markets.map((item) => <option key={item.id} value={item.id}>{marketLabel(item)} · {item.matchup} · {item.date}</option>)}
          </select>
          {!market && <p className="text-sm text-muted-foreground">The exact market is unavailable. Select a listed market to continue.</p>}
        </div>}
        <TabsContent value="research" className="space-y-4">
          {market && <>
            <ResearchForm key={`${market.id}:${view.board.snapshot.revision}`} market={market} initialLine={exactLine} ask={false} />
            <Card>
              <CardContent className="space-y-3 p-4">
                <h2 className="font-semibold">Compare sportsbooks</h2>
                {!market.quotes.length && <p className="text-sm text-muted-foreground">No quotes in this snapshot.</p>}
                <ul className="divide-y divide-border">
                  {market.quotes.map((offer) => {
                    const selection = selectionFor(market, offer);
                    const key = JSON.stringify([offer.book, offer.line]);
                    const fresh = quoteIsFresh(offer, view.board, new Date());
                    const inDraft = draft.some((leg) => leg.marketId === market.id && leg.line === offer.line);
                    return (
                      <li className="flex flex-wrap items-center justify-between gap-2 py-2.5" key={key}>
                        <div>
                          <p className="font-medium">{offer.book} · {sideLabel[market.side]} {offer.line} · {formatPrice(offer.price)}</p>
                          <p className="text-xs text-muted-foreground">{offer.main ? "Main line" : "Alternate"} · {formatStamp(offer.observedAt)}{fresh ? "" : " · Stale quote"}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" disabled={!fresh || inDraft || draft.length >= 8} onClick={() => setDraft((previous) => {
                            if (previous.length >= 8 || previous.some((leg) => leg.marketId === market.id && leg.line === offer.line)) return previous;
                            return [...previous, selection];
                          })}>{inDraft ? "In draft" : "Add to slip"}</Button>
                          <Button size="sm" variant="ghost" disabled={!fresh} onClick={() => {
                            setSelectedBook(key);
                            selectTab("watchlist");
                          }}>Follow</Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </>}
        </TabsContent>
        <TabsContent value="slips">
          <ResearchSlips board={view.board} slips={view.slips} draft={draft} setDraft={setDraft}
            busy={busy || isFetching} imported={imported} mutate={mutate} />
        </TabsContent>
        <TabsContent value="watchlist">
          <ResearchWatchlist key={JSON.stringify([market?.id, quote?.book, quote?.line])}
            market={market} quote={quote} view={view} busy={busy || isFetching} mutate={mutate} />
        </TabsContent>
        <TabsContent value="ask">
          {market && <ResearchForm key={`${market.id}:${view.board.snapshot.revision}`} market={market} initialLine={exactLine} ask />}
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">Historical results describe past games. <Link className="underline" to="/responsible-gambling">Responsible gambling resources</Link></p>
    </div>
  );
}

export default function NbaWorkflowPage() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <p className="p-5" role="status">Checking sign-in…</p>;
  if (!user) return (
    <div className="mx-auto max-w-md space-y-3 p-5">
      <h1 className="text-2xl font-bold">NBA Research</h1>
      <p className="text-sm text-muted-foreground">Sign in to research markets, review saved slips, and follow quote changes.</p>
      <Button asChild><Link to="/auth?next=nba" state={{ nbaSearch: location.search, nbaImport: location.state?.nbaImport }}>Sign in</Link></Button>
    </div>
  );
  return <Workflow key={user.id} userId={user.id} />;
}
