import { ArrowLeft, SlidersHorizontal, Trophy } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheatsheetRowCard } from "@/components/cheatsheets/CheatsheetRowCard";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { useSport } from "@/contexts/SportContext";
import { useCheatsheet } from "@/hooks/useCheatsheet";

export default function BestBetsCheatsheetPage() {
  const navigate = useNavigate();
  const { config } = useSport();
  const [minConfidence, setMinConfidence] = useState(55);
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, error } = useCheatsheet({
    category: "best-bets",
    minConfidence,
    limit: 50,
  });

  const rows = (data?.rows ?? []).filter((row) => (row.confidence_score ?? 0) >= minConfidence);

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
                {config.name} · Best Bets
              </p>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Trophy className="h-6 w-6 text-amber-400" />
                Highest Confidence Plays
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
            Top confidence-weighted plays from the latest verified scored slate.
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
              Minimum confidence score: <span className="text-foreground font-semibold">{minConfidence}</span>
            </Label>
            <Slider
              value={[minConfidence]}
              onValueChange={(v) => setMinConfidence(v[0])}
              min={40}
              max={90}
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
            Failed to load best bets cheatsheet. Try again shortly.
          </div>
        )}

        {!isLoading && !error && rows.length === 0 && (
          <div className="glass-card p-6 text-center">
            <p className="text-sm font-medium text-foreground mb-1">
              No verified plays found for this category yet.
            </p>
            <p className="text-xs text-muted-foreground">
              {data?.emptyReason ?? `No ${config.name} best bets right now.`}
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">
              {config.name} · {data?.effectiveDate ?? "No slate date"} · Try running `collect-line-snapshots` + `prop-scoring-engine` for the current slate.
            </p>
          </div>
        )}

        {!isLoading && !error && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((row) => (
              <CheatsheetRowCard key={row.id} row={row} highlight="confidence" />
            ))}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground mt-6 leading-relaxed">
          Best bets highlight the strongest scored plays available for the selected slate. They are not predictions or guarantees. Always bet responsibly.
        </p>
      </div>
      <Footer />
    </div>
  );
}
