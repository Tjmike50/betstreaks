// =============================================================================
// PlayerSearchTable — sortable/searchable list of players for Research.
// Rows link to /research/player/:playerId. Sport-aware via parent.
// =============================================================================
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpDown, ChevronDown, ChevronUp, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResearchPlayerRow } from "@/hooks/useResearchPlayers";

type SortKey = "name" | "team" | "streak" | "season" | "last10";
type SortDir = "asc" | "desc";

interface Props {
  rows: ResearchPlayerRow[];
  sport: string;
}

function getTeamLogoUrl(sport: string, abbr: string | null) {
  if (!abbr) return null;
  const league = sport.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/${league}/500/${abbr.toLowerCase()}.png`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  // Stored values are 0–1 in some places, 0–100 in others. Normalize.
  const pct = n <= 1 ? n * 100 : n;
  return `${Math.round(pct)}%`;
}

function pctValue(n: number | null | undefined): number {
  if (n == null || Number.isNaN(n)) return -1;
  return n <= 1 ? n * 100 : n;
}

export function PlayerSearchTable({ rows, sport }: Props) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("streak");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? rows.filter(
          (r) =>
            r.player_name.toLowerCase().includes(needle) ||
            (r.team_abbr ?? "").toLowerCase().includes(needle),
        )
      : rows;

    const sorted = [...base].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.player_name.localeCompare(b.player_name);
          break;
        case "team":
          cmp = (a.team_abbr ?? "").localeCompare(b.team_abbr ?? "");
          break;
        case "streak":
          cmp = a.top_streak_len - b.top_streak_len;
          break;
        case "season":
          cmp = (a.season_win_pct ?? 0) - (b.season_win_pct ?? 0);
          break;
        case "last10":
          cmp = pctValue(a.last10_hit_pct) - pctValue(b.last10_hit_pct);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [rows, q, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "team" ? "asc" : "desc");
    }
  }

  function SortHeader({ k, label, className }: { k: SortKey; label: string; className?: string }) {
    const active = sortKey === k;
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ChevronUp : ChevronDown;
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={cn(
          "flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search players or team abbr…"
          className="pl-9"
        />
      </div>

      <div className="text-xs text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "player" : "players"}
      </div>

      {/* Header row */}
      <div className="hidden md:grid grid-cols-[1fr_70px_90px_90px_80px] gap-3 px-3 pb-1 border-b border-border/50">
        <SortHeader k="name" label="Player" />
        <SortHeader k="team" label="Team" />
        <SortHeader k="streak" label="Streak" />
        <SortHeader k="season" label="Season" />
        <SortHeader k="last10" label="L10" />
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card p-6 text-center text-sm text-muted-foreground">
          No players match.
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.slice(0, 200).map((row) => (
            <button
              key={row.player_id}
              onClick={() => navigate(`/research/player/${row.player_id}`)}
              className="w-full glass-card hover:border-primary/50 transition-all p-3 text-left"
            >
              <div className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_70px_90px_90px_80px] gap-3 items-center">
                {/* Player */}
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={getTeamLogoUrl(sport, row.team_abbr) ?? undefined} alt="" />
                    <AvatarFallback className="text-xs bg-muted">
                      {row.player_name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">
                      {row.player_name}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {row.top_stat} {row.top_threshold}+ • {row.season_games} G
                    </div>
                  </div>
                </div>

                {/* Team (mobile compact / desktop column) */}
                <div className="md:block text-xs font-medium text-muted-foreground tabular-nums text-right md:text-left">
                  {row.team_abbr ?? "—"}
                </div>

                {/* Streak */}
                <div className="hidden md:block">
                  <Badge
                    variant="secondary"
                    className={cn(
                      "tabular-nums",
                      row.top_streak_len >= 5
                        ? "bg-amber-400/15 text-amber-400 border-amber-400/30"
                        : "",
                    )}
                  >
                    {row.top_streak_len > 0 ? `${row.top_streak_len} game` : "—"}
                  </Badge>
                </div>

                {/* Season */}
                <div className="hidden md:block text-sm font-semibold text-foreground tabular-nums">
                  {fmtPct(row.season_win_pct)}
                </div>

                {/* L10 */}
                <div className="hidden md:block text-sm font-semibold text-foreground tabular-nums">
                  {fmtPct(row.last10_hit_pct)}
                </div>
              </div>

              {/* Mobile-only secondary metrics row */}
              <div className="md:hidden mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Badge
                  variant="secondary"
                  className={cn(
                    "tabular-nums text-[10px]",
                    row.top_streak_len >= 5
                      ? "bg-amber-400/15 text-amber-400 border-amber-400/30"
                      : "",
                  )}
                >
                  {row.top_streak_len > 0 ? `${row.top_streak_len}-game` : "no streak"}
                </Badge>
                <span>Season {fmtPct(row.season_win_pct)}</span>
                <span>·</span>
                <span>L10 {fmtPct(row.last10_hit_pct)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {filtered.length > 200 && (
        <p className="text-center text-xs text-muted-foreground pt-2">
          Showing first 200 of {filtered.length}. Refine with search.
        </p>
      )}
    </div>
  );
}
