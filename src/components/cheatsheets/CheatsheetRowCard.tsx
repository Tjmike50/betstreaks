// =============================================================================
// CheatsheetRowCard — compact prop row used in Value/Streak/Matchup pages.
// =============================================================================
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CheatsheetRow } from "@/hooks/useCheatsheet";

interface Props {
  row: CheatsheetRow;
  /** Which numeric metric to highlight on the right (defaults to value). */
  highlight?: "value" | "confidence" | "last10" | "vs_opp";
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Math.round(v)}%`;
}

function fmtScore(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(0);
}

function scoreColor(v: number | null | undefined): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 75) return "text-emerald-400";
  if (v >= 60) return "text-primary";
  if (v >= 45) return "text-amber-400";
  return "text-muted-foreground";
}

export function CheatsheetRowCard({ row, highlight = "value" }: Props) {
  const navigate = useNavigate();

  const highlightValue =
    highlight === "value"
      ? { label: "Value", val: fmtScore(row.value_score), color: scoreColor(row.value_score) }
      : highlight === "confidence"
        ? { label: "Conf.", val: fmtScore(row.confidence_score), color: scoreColor(row.confidence_score) }
        : highlight === "last10"
          ? { label: "L10", val: fmtPct(row.last10_hit_rate), color: scoreColor(row.last10_hit_rate) }
          : { label: "vs Opp", val: fmtPct(row.vs_opponent_hit_rate), color: scoreColor(row.vs_opponent_hit_rate) };

  const matchup = row.opponent_abbr
    ? `${row.team_abbr ?? "—"} ${row.home_away === "away" ? "@" : "vs"} ${row.opponent_abbr}`
    : row.team_abbr ?? "";

  return (
    <button
      type="button"
      onClick={() => navigate(`/player/${row.player_id}`)}
      className="glass-card p-3 w-full text-left hover:border-primary/40 transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-foreground truncate">
              {row.player_name}
            </span>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {row.stat_type}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            Over {row.threshold} · {matchup}
          </p>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
            <span>L5: <span className="text-foreground font-medium">{fmtPct(row.last5_hit_rate)}</span></span>
            <span>L10: <span className="text-foreground font-medium">{fmtPct(row.last10_hit_rate)}</span></span>
            <span>Avg: <span className="text-foreground font-medium">{row.last10_avg?.toFixed(1) ?? "—"}</span></span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("text-2xl font-bold leading-none", highlightValue.color)}>
            {highlightValue.val}
          </div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">
            {highlightValue.label}
          </div>
        </div>
      </div>
    </button>
  );
}
