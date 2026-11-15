import { useState } from "react";
import { ArrowLeft, ArrowUpRight, BarChart3, Database, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/Footer";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useSport } from "@/contexts/SportContext";
import { useAnalyticsAssistant } from "@/hooks/useAnalyticsAssistant";
import {
  errors, maxQuestionLength, metrics, operators,
  type Calculation, type Provenance, type Reply,
} from "../../../supabase/functions/_shared/analyticsAssistant/contract.ts";

const examples = [
  { label: "Average points", question: "Average points for Avery Stone in the last 5 games" },
  { label: "At least 20 points", question: "How many times did Avery Stone score at least 20 points in the last 5 games?" },
  { label: "Ambiguous player", question: "Average assists for Jordan Reed in the last 5 games" },
];

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const timestamp = (value: string) => value.replace("T", " ").replace(/(?:\.\d+)?Z$/, " UTC");
const freshness = {
  stale: "Requested date exceeds source coverage",
  frozen_fixture: "Frozen synthetic snapshot",
  verified_snapshot: "Verified source snapshot",
};

function SourceDetails({ source }: { source: Provenance }) {
  const fields = [
    ["Dataset", source.dataset],
    ["Source", source.source],
    ["Revision", source.revision],
    ["Coverage through (Eastern)", source.coverageThrough],
    ["Latest eligible game (Eastern)", source.latestGameDate ?? "Unavailable"],
    ["Snapshot created", timestamp(source.snapshotAt)],
    ["Provider fetch", source.fetchedAt ? timestamp(source.fetchedAt) : "Unavailable"],
    ["Calculated at", timestamp(source.computedAt)],
  ];
  return (
    <section className="rounded-xl border bg-card p-5" aria-label="Source and dates">
      <h2 className="flex items-center gap-2 font-semibold"><Database size={16} /> Source and dates</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {freshness[source.freshness]}
      </p>
      <dl className="mt-4 space-y-3 text-sm">
        {fields.map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CalculationView({ calculation }: { calculation: Calculation }) {
  if (calculation.kind === "average") {
    return (
      <div className="space-y-1">
        <p className="text-4xl font-bold tabular-nums">{number.format(calculation.value)}</p>
        <p className="text-sm text-muted-foreground">
          Sum ÷ known appearances = {calculation.sum} ÷ {calculation.denominator} = {number.format(calculation.value)}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-4xl font-bold tabular-nums">{calculation.hits} / {calculation.denominator}</p>
      <p className="text-sm text-muted-foreground">
        {calculation.hits} of {calculation.denominator} appearances met {operators[calculation.comparator]} {calculation.threshold}.
        {" "}{calculation.ties} equal to the threshold{calculation.pushes > 0 && `, including ${calculation.pushes} pushes`}.
      </p>
    </div>
  );
}

function Result({ reply, select }: { reply: Reply; select: (id: number) => void }) {
  if (reply.status === "clarification") {
    return (
      <section className="rounded-xl border bg-card p-5" aria-label="Player clarification">
        <h2 className="font-semibold">Which player did you mean?</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {reply.choices.map((choice) => (
            <Button key={choice.id} variant="outline" onClick={() => select(choice.id)}>
              {choice.name} · {choice.team}
            </Button>
          ))}
        </div>
      </section>
    );
  }

  const { query, player, coverage, evidence, provenance } = reply;
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <section className="min-w-0 space-y-4 rounded-xl border bg-card p-5" aria-label="Analytics result">
        {query && player && (
          <div>
            <h2 className="text-lg font-semibold">{player.name} · {player.team}</h2>
            <p className="text-sm text-muted-foreground">
              {metrics[query.metric].label} · Last {query.window} appearances · Through {query.asOf} ET
            </p>
          </div>
        )}
        {reply.status === "answer"
          ? <CalculationView calculation={reply.calculation} />
          : <p role="alert" className="rounded-md bg-muted p-3 text-sm">{errors[reply.code]}</p>}
        {coverage && (
          <p className="text-sm text-muted-foreground">
            {coverage.appearances} of {coverage.requested} appearances · {coverage.known} known values
            {coverage.missing > 0 && ` · ${coverage.missing} missing`}
          </p>
        )}
        {evidence && evidence.length > 0 && query && (
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <caption className="sr-only">Selected appearance evidence</caption>
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 font-medium" scope="col">Game date</th>
                <th className="py-2 font-medium" scope="col">Game ID</th>
                <th className="py-2 text-right font-medium" scope="col">{query.metric}</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((row) => (
                <tr key={row.gameId} className="border-b last:border-0">
                  <td className="py-2 tabular-nums">{row.date}</td>
                  <td className="break-words py-2 text-xs text-muted-foreground">{row.gameId}</td>
                  <td className="py-2 text-right tabular-nums">{row.value ?? "Missing"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {reply.correlationId && <p className="break-all text-xs text-muted-foreground">Request ID {reply.correlationId}</p>}
      </section>
      {provenance && <SourceDetails source={provenance} />}
    </div>
  );
}

function Workbench() {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const { result, pending, hasContext, ask, select, cancel, reset } = useAnalyticsAssistant();

  function submit(value: string, fresh = false) {
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    setAsked(trimmed);
    void ask(trimmed, fresh);
  }

  return (
    <div className="space-y-4">
      <form className="space-y-4 rounded-xl border bg-card p-5" onSubmit={(event) => {
        event.preventDefault();
        submit(question);
      }}>
        <div className="space-y-2">
          <label htmlFor="analytics-question" className="font-medium">Ask an NBA stats question</label>
          <Textarea
            id="analytics-question"
            className="min-h-24 resize-y"
            maxLength={maxQuestionLength}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={examples[0].question}
          />
          <p className="text-sm text-muted-foreground">Use the last 5 or 10 games and a fixture player from the examples.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || !question.trim()}>
            {pending && <Loader2 size={16} className="animate-spin" />}
            Ask
          </Button>
          {pending && <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>}
          {(hasContext || result) && (
            <Button type="button" variant="ghost" onClick={() => { reset(); setAsked(""); setQuestion(""); }}>
              Start over
            </Button>
          )}
          {hasContext && (
            <Button type="button" variant="outline" disabled={pending} onClick={() => {
              setQuestion("What about rebounds?");
              submit("What about rebounds?");
            }}>What about rebounds?</Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {examples.map((example) => (
            <Button key={example.label} type="button" size="sm" variant="outline" disabled={pending}
              onClick={() => { setQuestion(example.question); submit(example.question, true); }}>
              {example.label} <ArrowUpRight size={13} />
            </Button>
          ))}
        </div>
      </form>
      {pending && <p role="status" className="text-sm text-muted-foreground">Checking the selected appearances…</p>}
      {result && (
        <div className="space-y-2">
          <p className="break-words text-sm text-muted-foreground">{asked}</p>
          <Result reply={result} select={(id) => { void select(id); }} />
        </div>
      )}
    </div>
  );
}

export default function AnalyticsAssistantPage() {
  const { user, isLoading } = useAuth();
  const { sport, setSport } = useSport();

  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 md:pb-10">
        <Link to="/research" className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} /> Research
        </Link>
        <header className="mb-5 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <BarChart3 className="text-primary" size={22} aria-hidden="true" />
            <h1 className="text-2xl font-bold md:text-3xl">AI Analytics Assistant</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Synthetic NBA demo · Ask about points, rebounds, assists or three-pointers made.
          </p>
        </header>
        {isLoading ? <p role="status">Checking your session…</p>
          : !user ? (
            <section className="rounded-xl border bg-card p-5">
              <h2 className="font-semibold">Sign in to use the assistant</h2>
              <Button asChild className="mt-3"><Link to="/auth?next=analytics">Sign in</Link></Button>
            </section>
          ) : sport !== "NBA" ? (
            <section className="rounded-xl border bg-card p-5">
              <p>This assistant supports NBA fixture questions.</p>
              <Button className="mt-3" onClick={() => setSport("NBA")}>Switch to NBA</Button>
            </section>
          ) : <Workbench key={user.id} />}
      </div>
      <Footer />
    </div>
  );
}
