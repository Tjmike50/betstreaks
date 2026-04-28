// =============================================================================
// StreakCheatsheetPage — players cashing 7+ of their last 10.
// Reuses useCheatsheet (category=streaks) and CheatsheetRowCard.
// =============================================================================
import { useState } from "react";
import { ArrowLeft, Flame, SlidersHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSport } from "@/contexts/SportContext";
import { useCheatsheet } from "@/hooks/useCheatsheet";
import { CheatsheetRowCard } from "@/components/cheatsheets/CheatsheetRowCard";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

function normalizeRate(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value <= 1 ? value * 100 : value;
}

export default function StreakCheatsheetPage() {
  const navigate = useNavigate();
  const { config } = useSport();
  const [minHitRate, setMinHitRate] = useState(70);
  const [showFilters, setShowFilters] = useState(false);

  // useCheatsheet's "streaks" category enforces last10_hit_rate >= 70 by default.
  // We re-filter client-side to honor the user's slider.
  const { data, isLoading, error } = useCheatsheet({
    category: "streaks",
    limit: 80,
  });

  const filtered = (data?.rows ?? []).filter(
    (r) => normalizeRate(r.last10_hit_rate) >= minHitRate,
  );

  return (
    <div className="min-h-screen pb-24 md:pb-8">
      <div className="max-w-3xl mx-auto px-4 pt-4">
        <button
          onClick={() => navigate("/cheatsheets")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Cheatsheets
        </button>

        <header className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-primary mb-1">
                {config.name} · Hot Streaks
              </p>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Flame className="h-6 w-6 text-emerald-400" />
                Players Running Hot
              </h1>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((v) => !v)}
              className="shrink-0"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Props hitting in 7+ of the last 10 games. Recent form is strong.
          </p>
          {data?.effectiveDate && (
            <p className="text-xs text-muted-foreground mt-2">
              {data.usingLatestFallback
                ? `Showing latest available slate: ${data.effectiveDate}`
                : `Slate date: ${data.effectiveDate}`}
            </p>
          )}
        </header>

        {showFilters && (
          <div className="glass-card p-4 mb-4">
            <Label className="text-xs font-medium text-muted-foreground mb-2 block">
              Minimum L10 hit rate: <span className="text-foreground font-semibold">{minHitRate}%</span>
            </Label>
            <Slider
              value={[minHitRate]}
              onValueChange={(v) => setMinHitRate(v[0])}
              min={60}
              max={95}
              step={5}
            />
          </div>
        )}

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        )}

        {error && (
          <div className="glass-card p-4 text-sm text-destructive">
            Failed to load streak cheatsheet. Try again shortly.
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="glass-card p-6 text-center">
            <Flame className="h-9 w-9 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm font-medium text-foreground mb-1">
              No hot streaks at this threshold
            </p>
            <p className="text-xs text-muted-foreground">
              {data?.emptyReason ?? `Try lowering the minimum hit rate, or check back after tonight's ${config.name} games.`}
            </p>
            {data?.effectiveDate && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Slate: {data.effectiveDate}
              </p>
            )}
          </div>
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map((row) => (
              <CheatsheetRowCard key={row.id} row={row} highlight="last10" />
            ))}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground mt-6 leading-relaxed">
          Hit rates reflect historical game logs. Past performance is not a prediction or guarantee. Always bet responsibly.
        </p>
      </div>
      <Footer />
    </div>
  );
}
