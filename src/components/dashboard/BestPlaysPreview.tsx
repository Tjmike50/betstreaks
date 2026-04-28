// =============================================================================
// BestPlaysPreview — top 3 best plays for the active sport on the Dashboard.
// Uses the same scored-props cheatsheet source as the category pages so the
// dashboard can fall back to the latest verified slate instead of legacy
// streak-only data.
// =============================================================================
import { useNavigate } from "react-router-dom";
import { Trophy, ArrowRight, Flame } from "lucide-react";
import { useCheatsheet, type CheatsheetRow } from "@/hooks/useCheatsheet";
import { useSport } from "@/contexts/SportContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { compactStatLabel } from "@/lib/mlbStatLabels";

function rowHref(row: CheatsheetRow): string {
  return `/research/player/${row.player_id}`;
}

export function BestPlaysPreview() {
  const navigate = useNavigate();
  const { config } = useSport();
  const { data, isLoading, error } = useCheatsheet({
    category: "best-bets",
    limit: 3,
    minConfidence: 55,
  });

  const isOffseason = config.seasonState === "offseason";
  const rows = data?.rows ?? [];
  const effectiveDateLabel =
    data?.effectiveDate &&
    (data.usingLatestFallback
      ? `Showing latest available slate: ${data.effectiveDate}`
      : `Slate date: ${data.effectiveDate}`);

  return (
    <section className="px-4 pt-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-400" />
          <h2 className="text-base font-semibold text-foreground">Best Plays</h2>
        </div>
        <button
          type="button"
          onClick={() => navigate("/cheatsheets/best-bets")}
          className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
        >
          View all
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
      {effectiveDateLabel && (
        <p className="text-[11px] text-muted-foreground mb-2">{effectiveDateLabel}</p>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="glass-card p-4 text-center">
          <p className="text-xs text-muted-foreground">
            Couldn't load best plays. Try again soon.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="glass-card p-5 text-center">
          <Trophy className="h-7 w-7 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm font-medium text-foreground">
            {isOffseason
              ? `${config.shortName} is in offseason`
              : "No best plays yet"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isOffseason
              ? "Best Plays will return when the season resumes."
              : data?.emptyReason ?? "No verified plays found for this category yet."}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">
            {config.shortName} · Requested today, using {data?.effectiveDate ?? "latest available"}.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, idx) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => navigate(rowHref(row))}
                className="w-full glass-card p-3 flex items-center gap-3 text-left hover:border-primary/40 transition-colors"
              >
                <div
                  className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    idx === 0
                      ? "bg-amber-500 text-black"
                      : idx === 1
                      ? "bg-muted text-foreground"
                      : "bg-amber-700 text-white"
                  }`}
                >
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-foreground truncate">
                      {row.player_name}
                    </p>
                    {row.team_abbr && (
                      <span className="text-[10px] text-muted-foreground">
                        {row.team_abbr}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {compactStatLabel(row.stat_type)} O{row.threshold} ·{" "}
                    {row.opponent_abbr
                      ? `${row.team_abbr ?? ""} ${row.home_away === "away" ? "@" : "vs"} ${row.opponent_abbr}`
                      : `${Math.round(row.last10_hit_rate ?? 0)}% L10`}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="gap-1 text-xs flex-shrink-0"
                >
                  <Flame className="h-3 w-3 text-amber-400" />
                  {Math.round(row.confidence_score ?? row.score_overall ?? 0)}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
