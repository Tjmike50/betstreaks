import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { metrics } from "../../../supabase/functions/_shared/analyticsAssistant/contract";
import { marketFor, selectionFor, sideLabel, watchKey, type Market, type Preferences, type Quote, type WorkflowView } from "../../../supabase/functions/_shared/nbaWorkflow/domain";
import { formatStamp } from "./client";

const labels = { line: "Line movement", price: "Price changes", availability: "Player availability", result: "Final results" };
const kinds = Object.keys(labels) as (keyof typeof labels)[];

async function enableBrowserPush(key: string) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new Error("This browser does not support push notifications.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was declined.");
  await navigator.serviceWorker.register("/nba-research-push.js", { scope: "/research/nba" });
  const registration = await navigator.serviceWorker.getRegistration("/research/nba");
  if (!registration) throw new Error("The push service could not be registered.");
  if (!registration.active) {
    const worker = registration.installing ?? registration.waiting;
    if (!worker) throw new Error("The push service is not active.");
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (worker.state === "activated") resolve();
        if (worker.state === "redundant") reject(new Error("The push service could not be activated."));
      };
      worker.addEventListener("statechange", check);
      check();
    });
  }
  const previous = await registration.pushManager.getSubscription();
  if (previous) return previous;
  const padded = key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "=");
  const applicationServerKey = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

export function ResearchWatchlist({ market, quote, view, busy, mutate }: {
  market: Market | undefined;
  quote: Quote | undefined;
  view: WorkflowView;
  busy: boolean;
  mutate: (input: object) => Promise<boolean>;
}) {
  const leg = market && quote ? { ...market, quote } : undefined;
  const rule = leg ? view.watch.find((entry) => watchKey(entry.leg) === watchKey(leg)) : undefined;
  const [types, setTypes] = useState(() => ({ line: rule?.line ?? true, price: rule?.price ?? true,
    availability: rule?.availability ?? true, result: rule?.result ?? true }));
  const [preferences, setPreferences] = useState<Preferences>(view.preferences);
  const [pushError, setPushError] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const unread = view.updates.filter((event) => !view.read.includes(event.id)).length;

  async function togglePush() {
    setPushError("");
    setPushBusy(true);
    try {
      if (view.pushEnabled) {
        if (await mutate({ action: "push", subscription: null }) && "serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration("/research/nba");
          await (await registration?.pushManager.getSubscription())?.unsubscribe();
        }
      } else if (view.pushPublicKey) {
        const subscription = await enableBrowserPush(view.pushPublicKey);
        await mutate({ action: "push", subscription: subscription.toJSON() });
      }
    } catch (error) {
      setPushError(error instanceof Error ? error.message : "Browser push could not be configured.");
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Watchlist brief</h2>
            {!!unread && <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate({ action: "read" })}>Mark updates read</Button>}
          </div>
          {!view.updates.length && <p className="text-sm text-muted-foreground">No changes for followed quotes.</p>}
          {!!view.updates.length && <ul className="divide-y divide-border">
            {view.updates.map((event) => (
              <li className="py-2.5 text-sm" key={event.id}>
                <div className="flex items-center gap-2">
                  <p>{event.text}</p>{!view.read.includes(event.id) && <Badge variant="outline">New</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{formatStamp(event.observedAt)}</p>
              </li>
            ))}
          </ul>}
          {!!view.watch.length && <ul aria-label="Followed quotes" className="space-y-2">
            {view.watch.map(({ leg }) => {
              const current = marketFor(leg, view.board);
              return (
                <li key={watchKey(leg)} className="flex items-center justify-between gap-2 rounded border border-border p-2 text-sm">
                  <div>
                    <p>{leg.player.name} · {sideLabel[leg.side]} {leg.quote.line} {metrics[leg.metric].label} · {leg.quote.book}</p>
                    <p className="text-xs text-muted-foreground">{current ? `${current.matchup} · ${current.date}` : "Event unavailable"}</p>
                  </div>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate({ action: "unwatch", key: watchKey(leg) })}>Unfollow</Button>
                </li>
              );
            })}
          </ul>}
        </CardContent>
      </Card>

      {market && quote && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="font-semibold">Follow this quote</h2>
            <p className="text-sm text-muted-foreground">{market.player.name} · {sideLabel[market.side]} {quote.line} {metrics[market.metric].label} · {quote.book}</p>
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Which updates to follow</legend>
              {kinds.map((kind) => <label className="flex items-center gap-2 text-sm" key={kind}>
                <input type="checkbox" checked={types[kind]} onChange={(event) => setTypes({ ...types, [kind]: event.target.checked })} />
                {labels[kind]}
              </label>)}
            </fieldset>
            <Button disabled={busy || !Object.values(types).some(Boolean)} onClick={() =>
              void mutate({ action: "watch", leg: selectionFor(market, quote), types })}>{rule ? "Update followed quote" : "Follow quote"}</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="font-semibold">Notification preferences</h2>
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void mutate({ action: "preferences", preferences }); }}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={preferences.enabled} onChange={(event) => setPreferences({ ...preferences, enabled: event.target.checked })} />
              Allow browser notifications outside quiet hours
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label className="text-sm">Quiet hours start
                <Input type="number" min={0} max={23} required value={preferences.quietStart}
                  onChange={(event) => setPreferences({ ...preferences, quietStart: event.target.valueAsNumber })} />
              </label>
              <label className="text-sm">Quiet hours end
                <Input type="number" min={0} max={23} required value={preferences.quietEnd}
                  onChange={(event) => setPreferences({ ...preferences, quietEnd: event.target.valueAsNumber })} />
              </label>
              <label className="col-span-2 text-sm sm:col-span-1">Time zone
                <Input required value={preferences.timeZone} maxLength={80}
                  onChange={(event) => setPreferences({ ...preferences, timeZone: event.target.value })} />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">Use 24-hour time. Matching start and end disables quiet hours.</p>
            <Button type="submit" variant="outline" disabled={busy}>Save preferences</Button>
          </form>
          <Button type="button" variant="outline" disabled={busy || pushBusy || (!view.pushPublicKey && !view.pushEnabled)}
            onClick={() => void togglePush()}>{view.pushEnabled ? "Disable browser push" : "Enable browser push"}</Button>
          {!view.pushPublicKey && <p className="text-xs text-muted-foreground">Browser push is unavailable in this environment. In-app updates are active.</p>}
          {pushError && <p role="alert" className="text-sm text-destructive">{pushError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
