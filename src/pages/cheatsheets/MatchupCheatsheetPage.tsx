// =============================================================================
// MatchupCheatsheetPage — players with strong vs-opponent history tonight.
// Reuses useCheatsheet (category=matchups) and CheatsheetRowCard.
// =============================================================================
import { useState } from "react";
import { ArrowLeft, Swords, SlidersHorizontal } from "lucide-react";
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

function hasHistoricalVsOppData(vsOppRate: number | null | undefined, vsOppGames: number | null | undefined): boolean {
  return normalizeRate(vsOppRate) > 0 && (vsOppGames ?? 0) >= 2;
}

export default function MatchupCheatsheetPage() {
  const navigate = useNavigate();
  const { config } = useSport();
  const [minVsOppRate, setMinVsOppRate] = useState(60);
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, error } = useCheatsheet({
    category: "matchups",
    limit: 80,
  });

  // Honor the slider only when we actually have opponent-history metrics.
  // For MLB, fallback matchup rows can still be useful even if the backend
  // hasn't populated robust vs-opponent history yet.
  const filtered = (data?.rows ?? []).filter(
    (r) => {
      if (!hasHistoricalVsOppData(r.vs_opponent_hit_rate, r.vs_opponent_games)) {
        return true;
      }
      return normalizeRate(r.vs_opponent_hit_rate) >= minVsOppRate;
    },
  );

  const hasOnlyFallbackRows =
    (data?.rows ?? []).length > 0 &&
    (data?.rows ?? []).every((row) => !hasHistoricalVsOppData(row.vs_opponent_hit_rate, row.vs_opponent_games));

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
                {config.name} · Matchup Edges
              </p>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Swords className="h-6 w-6 text-violet-400" />
                Favorable Matchups
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
            Players with strong historical hit rates against tonight's opponent.
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
              Min vs-opponent hit rate: <span className="text-foreground font-semibold">{minVsOppRate}%</span>
            </Label>
            <Slider
              value={[minVsOppRate]}
              onValueChange={(v) => setMinVsOppRate(v[0])}
              min={50}
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
            Failed to load matchup cheatsheet. Try again shortly.
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="glass-card p-6 text-center">
            <Swords className="h-9 w-9 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm font-medium text-foreground mb-1">
              {config.key === "MLB" ? "Matchup edges coming soon" : "No matchup edges at this threshold"}
            </p>
            <p className="text-xs text-muted-foreground">
              {config.key === "MLB"
                ? data?.emptyReason ?? "MLB matchup history is still being filled in. No verified matchup data is available for this slate yet."
                : data?.emptyReason ?? "Try lowering the minimum vs-opponent hit rate. Matchup edges require at least 2 prior games vs tonight's opponent."}
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">
              {config.shortName} · Requested {data?.requestedDate ?? "today"} · Using {data?.effectiveDate ?? "latest available"} · {data?.rowsScanned ?? data?.rawRowCount ?? 0} rows scanned · {data?.rowsMatched ?? data?.filteredRowCount ?? 0} matched.
            </p>
          </div>
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <div className="space-y-2">
            {config.key === "MLB" && hasOnlyFallbackRows && (
              <div className="glass-card p-4 text-xs text-muted-foreground">
                Matchup history is still limited for MLB, so these cards are using fallback matchup scoring from the latest verified prop slate.
              </div>
            )}
            {filtered.map((row) => (
              <CheatsheetRowCard key={row.id} row={row} highlight="vs_opp" />
            ))}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground mt-6 leading-relaxed">
          Matchup history requires at least 2 prior games vs the opponent. Past results are not a prediction or guarantee. Always bet responsibly.
        </p>
      </div>
      <Footer />
    </div>
  );
}
