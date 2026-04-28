// =============================================================================
// HotStreaksStrip — top active player streaks for the active sport.
// Uses the scored-props cheatsheet source so the dashboard can fall back to the
// latest verified slate even when legacy streak tables are sparse.
// =============================================================================
import { useNavigate } from "react-router-dom";
import { ArrowRight, Flame } from "lucide-react";
import { useCheatsheet } from "@/hooks/useCheatsheet";
import { useSport } from "@/contexts/SportContext";
import { Skeleton } from "@/components/ui/skeleton";
import { CheatsheetRowCard } from "@/components/cheatsheets/CheatsheetRowCard";

const MAX_ROWS = 3;

export function HotStreaksStrip() {
  const navigate = useNavigate();
  const { config } = useSport();
  const { data, isLoading } = useCheatsheet({
    category: "streaks",
    limit: MAX_ROWS,
  });

  const isOffseason = config.seasonState === "offseason";
  const top = data?.rows ?? [];
  const effectiveDateLabel =
    data?.effectiveDate &&
    (data.usingLatestFallback
      ? `Showing latest available slate: ${data.effectiveDate}`
      : `Slate date: ${data.effectiveDate}`);

  return (
    <section className="px-4 pt-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-amber-400" />
          <h2 className="text-base font-semibold text-foreground">Hot Streaks</h2>
        </div>
        {top.length > 0 && (
          <button
            type="button"
            onClick={() => navigate("/cheatsheets/hot-streaks")}
            className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
      {effectiveDateLabel && (
        <p className="text-[11px] text-muted-foreground mb-2">{effectiveDateLabel}</p>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      ) : top.length === 0 ? (
        <div className="glass-card p-5 text-center">
          <Flame className="h-7 w-7 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm font-medium text-foreground">
            {isOffseason ? `${config.shortName} streaks paused` : "No active streaks yet"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isOffseason
              ? "We'll surface fresh streaks when the season tips off."
              : data?.emptyReason ?? "No verified plays found for this category yet."}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">
            {config.shortName} · Requested today, using {data?.effectiveDate ?? "latest available"}.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {top.map((row) => (
            <CheatsheetRowCard key={row.id} row={row} highlight="last10" />
          ))}
        </div>
      )}
    </section>
  );
}
