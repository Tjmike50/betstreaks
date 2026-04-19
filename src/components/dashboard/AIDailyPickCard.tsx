// =============================================================================
// AIDailyPickCard — surfaces the latest ai_daily_picks row on the Dashboard.
// Empty state directs users to AI Builder. Does NOT modify AI Builder itself.
// =============================================================================
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, Wand2 } from "lucide-react";
import { useAIDailyPick } from "@/hooks/useAIDailyPick";
import { useSport } from "@/contexts/SportContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RegenerateDailyPickButton } from "@/components/dashboard/RegenerateDailyPickButton";

// Friendly display labels for stat codes (matches conventions used elsewhere
// in the app — keeps deterministic per-leg text readable on mobile).
const STAT_DISPLAY: Record<string, string> = {
  pts: "PTS",
  reb: "REB",
  ast: "AST",
  stl: "STL",
  blk: "BLK",
  fg3m: "3PM",
  pra: "PRA",
  pr: "PR",
  pa: "PA",
  ra: "RA",
};

function formatStat(stat: string): string {
  return STAT_DISPLAY[stat.toLowerCase()] ?? stat.toUpperCase();
}

export function AIDailyPickCard() {
  const navigate = useNavigate();
  const { config } = useSport();
  const { data: pick, isLoading } = useAIDailyPick();

  return (
    <section className="px-4 pt-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">AI Daily Pick</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <RegenerateDailyPickButton hasExistingPick={!!pick} />
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            AI Suggestion
          </Badge>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full rounded-lg" />
      ) : !pick ? (
        <div className="glass-card p-5 text-center">
          <Wand2 className="h-7 w-7 mx-auto text-primary/60 mb-2" />
          <p className="text-sm font-medium text-foreground">
            No AI pick available yet today
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">
            {config.seasonState === "offseason"
              ? `${config.shortName} is in offseason — picks resume next season.`
              : "Build your own slip with the AI Bet Builder."}
          </p>
          {config.seasonState !== "offseason" && (
            <Button
              size="sm"
              onClick={() => navigate("/ai-builder")}
              className="gap-1.5"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Open AI Builder
            </Button>
          )}
        </div>
      ) : (
        <div className="glass-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {pick.slip_name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-[10px] capitalize">
                  {pick.risk_label}
                </Badge>
                {pick.estimated_odds && (
                  <span className="text-xs text-muted-foreground">
                    Est. {pick.estimated_odds}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  · {pick.legs.length} leg{pick.legs.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>

          {pick.legs.length > 0 && (
            <ul className="space-y-1.5">
              {pick.legs.slice(0, 3).map((leg) => (
                <li
                  key={leg.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="text-foreground truncate">
                    <span className="font-medium">{leg.player_name}</span>{" "}
                    <span className="text-muted-foreground">
                      {leg.pick} {leg.line} {formatStat(leg.stat_type)}
                    </span>
                  </span>
                  {leg.odds && (
                    <span className="text-muted-foreground tabular-nums">
                      {leg.odds}
                    </span>
                  )}
                </li>
              ))}
              {pick.legs.length > 3 && (
                <li className="text-[11px] text-muted-foreground italic">
                  +{pick.legs.length - 3} more leg
                  {pick.legs.length - 3 === 1 ? "" : "s"}
                </li>
              )}
            </ul>
          )}

          {pick.reasoning && (
            <p className="text-xs text-muted-foreground italic leading-relaxed">
              {pick.reasoning}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/ai-builder")}
              className="flex-1 gap-1.5 text-xs"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Build your own
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate("/saved-slips")}
              className="gap-1 text-xs"
            >
              Saved
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground text-center pt-1 border-t border-border/40">
            AI suggestion · not financial advice · 21+ · please bet responsibly
          </p>
        </div>
      )}
    </section>
  );
}
