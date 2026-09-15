import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

export function WeeklyPassCard({ weeks, onWeeksChange, onCheckout, loading, loggedIn, expiresAt }: {
  weeks: string; onWeeksChange: (value: string) => void; onCheckout: () => void;
  loading: boolean; loggedIn: boolean; expiresAt: string | null;
}) {
  const count = Number(weeks);
  const valid = Number.isInteger(count) && count >= 1 && count <= 520;
  const total = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(count * 5);
  const extending = expiresAt && Date.parse(expiresAt) > Date.now();
  return (
    <Card className="border-primary/50 bg-card">
      <CardContent className="p-6 space-y-4">
        <div>
          <h2 className="text-xl font-bold">{extending ? "Add more weeks" : "Choose your weeks"}</h2>
          <p className="text-muted-foreground text-sm mt-1">All BetStreaks Premium features. $5 per week, paid upfront.</p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <label htmlFor="prepaid-weeks" className="text-sm font-medium">Number of weeks</label>
            <Input id="prepaid-weeks" type="number" min="1" max="520" step="1" inputMode="numeric" value={weeks} onChange={event => onWeeksChange(event.target.value)} className="w-36" aria-invalid={!valid} aria-describedby="weekly-terms" />
          </div>
          <p className="pb-2" aria-live="polite"><span className="text-3xl font-bold">{valid ? total : "—"}</span><span className="text-sm text-muted-foreground ml-2">total upfront</span></p>
        </div>
        <p id="weekly-terms" className="text-sm text-muted-foreground">
          {!valid ? "Enter a whole number from 1 to 520 weeks." : `${count} ${count === 1 ? "week" : "weeks"} of access. No automatic renewal.`}
          {extending ? " Added weeks start when your current prepaid pass ends." : " Access starts after payment is confirmed. Each week is 7 days."}
        </p>
        <Button className="w-full" size="lg" disabled={!valid || loading} onClick={onCheckout}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : loggedIn ? `Buy ${valid ? count : ""} ${count === 1 ? "week" : "weeks"}${valid ? ` · ${total}` : ""}` : "Log in to buy weeks"}
        </Button>
      </CardContent>
    </Card>
  );
}
