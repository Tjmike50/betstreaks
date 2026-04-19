// =============================================================================
// ValueCheatsheetPage — top value-score props for the active sport.
// First NBA upgrade block; WNBA inherits via useSport / useCheatsheet.
// =============================================================================
import { useState } from "react";
import { ArrowLeft, TrendingUp, SlidersHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSport } from "@/contexts/SportContext";
import { useCheatsheet } from "@/hooks/useCheatsheet";
import { CheatsheetRowCard } from "@/components/cheatsheets/CheatsheetRowCard";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

export default function ValueCheatsheetPage() {
  const navigate = useNavigate();
  const { config } = useSport();
  const [minValueScore, setMinValueScore] = useState(60);
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, error } = useCheatsheet({
    category: "value",
    minValueScore,
    limit: 50,
  });

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
                {config.name} · Value Plays
              </p>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <TrendingUp className="h-6 w-6 text-primary" />
                Top Value Today
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
            Props where recent form most exceeds the posted line.
          </p>
        </header>

        {showFilters && (
          <div className="glass-card p-4 mb-4">
            <Label className="text-xs font-medium text-muted-foreground mb-2 block">
              Minimum value score: <span className="text-foreground font-semibold">{minValueScore}</span>
            </Label>
            <Slider
              value={[minValueScore]}
              onValueChange={(v) => setMinValueScore(v[0])}
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
            Failed to load value cheatsheet. Try again shortly.
          </div>
        )}

        {!isLoading && !error && data && data.length === 0 && (
          <div className="glass-card p-6 text-center">
            <p className="text-sm font-medium text-foreground mb-1">
              No {config.name} value plays right now
            </p>
            <p className="text-xs text-muted-foreground">
              {config.seasonState === "offseason"
                ? `${config.name} is in offseason. Check back when the season resumes.`
                : "Try lowering the minimum value score, or check back closer to tip-off."}
            </p>
          </div>
        )}

        {!isLoading && !error && data && data.length > 0 && (
          <div className="space-y-2">
            {data.map((row) => (
              <CheatsheetRowCard key={row.id} row={row} highlight="value" />
            ))}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground mt-6 leading-relaxed">
          Value scores compare recent player performance against the posted line. Not a prediction or guarantee. Always bet responsibly.
        </p>
      </div>
      <Footer />
    </div>
  );
}
