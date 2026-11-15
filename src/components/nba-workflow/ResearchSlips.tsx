import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { metrics } from "../../../supabase/functions/_shared/analyticsAssistant/contract";
import { selectionFor, sideLabel, type Board, type Selection, type WorkflowView } from "../../../supabase/functions/_shared/nbaWorkflow/domain";
import { formatPrice, formatStamp, importDraft, marketLabel, parseSlipText, selectionKey, type ImportedLeg } from "./client";

export function ResearchSlips({ board, slips, draft, setDraft, imported, busy, mutate }: {
  board: Board;
  slips: WorkflowView["slips"];
  draft: Selection[];
  setDraft: React.Dispatch<React.SetStateAction<Selection[]>>;
  imported?: ImportedLeg[];
  busy: boolean;
  mutate: (input: object) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [id, setId] = useState(() => crypto.randomUUID());
  const [pasted, setPasted] = useState("");
  const [rows, setRows] = useState<ImportedLeg[]>([]);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  useEffect(() => {
    if (imported?.length) setRows(imported.slice(0, 8));
  }, [imported]);

  const settled = (state: string) => ({
    line_moved: "Line moved", price_changed: "Price changed", unchanged: "Unchanged", unverified: "Unverified", stale: "Quote stale",
  })[state] ?? state;
  const importRows = () => {
    try {
      setRows(parseSlipText(pasted));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Check the pasted rows.");
    }
  };
  const save = async () => {
    if (await mutate({ action: "save", id, name, legs: draft })) {
      setDraft([]);
      setName("");
      setId(crypto.randomUUID());
      setRows([]);
      setPasted("");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <h2 className="font-semibold">Research slip draft</h2>
            <p className="text-sm text-muted-foreground">Save the exact quotes you want to track.</p>
          </div>
          <details className="rounded-md border border-border p-3" open={rows.length > 0 || undefined}>
            <summary className="cursor-pointer text-sm font-medium">Import legs</summary>
            <div className="mt-3 space-y-2">
              <label htmlFor="nba-import" className="text-sm text-muted-foreground">One leg per row · Player | Stat | Side | Line | Sportsbook</label>
              <Textarea id="nba-import" rows={3} maxLength={1800} value={pasted} onChange={(event) => setPasted(event.target.value)} />
              <Button type="button" variant="outline" size="sm" onClick={importRows} disabled={!pasted.trim()}>Match pasted legs</Button>
              <p role="alert" className="text-xs text-destructive">{error}</p>
              {importDraft(rows, board).map((row, index) => (
                <div key={index} className="space-y-2 rounded border border-border p-2.5 text-sm">
                  <p className="font-medium">{row.label}</p>
                  {row.matches.length ? (
                    <>
                      {row.matches.length > 1 && <p className="text-xs text-muted-foreground">Choose the exact market and sportsbook.</p>}
                      <div className="flex flex-wrap gap-2">
                        {row.matches.map(({ market, quote }) => {
                          const choice = selectionFor(market, quote);
                          return (
                            <Button key={selectionKey(choice)} size="sm" variant="outline" disabled={draft.length >= 8 ||
                              draft.some((leg) => leg.marketId === choice.marketId && leg.line === choice.line)} onClick={() => {
                                setDraft((previous) => [...previous, choice]);
                                setRows((previous) => previous.filter((_, i) => i !== index));
                              }}>{market.player.team} · {market.matchup} · {quote.book} {formatPrice(quote.price)}</Button>
                          );
                        })}
                      </div>
                    </>
                  ) : <p className="text-xs text-muted-foreground">No exact market and quote match. Edit the import or choose a current quote in Research.</p>}
                </div>
              ))}
            </div>
          </details>
          {!draft.length && <p className="text-sm text-muted-foreground">Add a quote from Research or import a leg above.</p>}
          {draft.map((leg) => {
            const market = board.markets.find((item) => item.id === leg.marketId);
            const label = market ? marketLabel(market) : "Market unavailable";
            return (
              <div key={selectionKey(leg)} className="flex items-center justify-between gap-2 rounded border border-border p-2.5 text-sm">
                <p>{label} {leg.line} <span className="text-muted-foreground">· {leg.book} {formatPrice(leg.price)}</span></p>
                <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${label} from draft`} onClick={() =>
                  setDraft((previous) => previous.filter((item) => selectionKey(item) !== selectionKey(leg)))}>Remove</Button>
              </div>
            );
          })}
          {draft.length > 0 && (
            <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <div className="min-w-40 flex-1">
                <label htmlFor="nba-slip-name" className="text-sm font-medium">Slip name</label>
                <Input id="nba-slip-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
              </div>
              <Button type="submit" disabled={busy || !name.trim()}>Save research slip</Button>
            </form>
          )}
        </CardContent>
      </Card>
      <h2 className="text-lg font-semibold">Saved research slips</h2>
      {!slips.length && <p className="text-sm text-muted-foreground">Your saved slips will appear here.</p>}
      {slips.map((slip) => {
        const sameGame = new Set(slip.legs.map(({ leg }) => leg.eventId)).size < slip.legs.length;
        return (
          <Card key={slip.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h3 className="font-semibold">{slip.name}</h3><p className="text-xs text-muted-foreground">Saved {formatStamp(slip.createdAt)}</p></div>
                {confirmRemove === slip.id ? (
                  <div className="flex gap-2">
                    <Button disabled={busy} variant="outline" size="sm" onClick={() => setConfirmRemove(null)}>Cancel</Button>
                    <Button disabled={busy} variant="destructive" size="sm" onClick={async () => {
                      if (await mutate({ action: "remove", id: slip.id })) setConfirmRemove(null);
                    }}>Confirm removal</Button>
                  </div>
                ) : <Button disabled={busy} variant="ghost" size="sm" onClick={() => setConfirmRemove(slip.id)}>Remove slip</Button>}
              </div>
              {sameGame && <p className="text-xs text-muted-foreground">Some legs share a game. Combined pricing requires a sportsbook quote.</p>}
              <ul className="divide-y divide-border">
                {slip.legs.map(({ leg, quote, state, result, actual, resultAt }) => (
                  <li key={JSON.stringify([leg.id, leg.quote.book, leg.quote.line])} className="space-y-1 py-2.5">
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="text-sm font-medium">{leg.player.name} · {sideLabel[leg.side]} {leg.quote.line} {metrics[leg.metric].label}</p>
                      <Badge className="capitalize" variant="outline">{result}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Saved quote · {leg.quote.book} {leg.quote.line} ({formatPrice(leg.quote.price)}) · {formatStamp(leg.quote.observedAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {settled(state)}{quote && <> · {quote.line} ({formatPrice(quote.price)}) · {formatStamp(quote.observedAt)}</>}
                    </p>
                    {actual !== null && <p className="text-xs">Final statistic · {actual}{resultAt && <> · {formatStamp(resultAt)}</>}</p>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
