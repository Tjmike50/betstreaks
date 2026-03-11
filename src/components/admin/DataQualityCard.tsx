import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Database, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface PlayerGameCount {
  player_name: string;
  team_abbr: string | null;
  game_count: number;
  earliest: string;
  latest: string;
}

type SortField = "game_count" | "player_name";
type FilterMode = "all" | "low" | "critical";

export function DataQualityCard() {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("low");
  const [sortField, setSortField] = useState<SortField>("game_count");
  const [sortAsc, setSortAsc] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ["data-quality-player-counts"],
    queryFn: async () => {
      // Fetch all player game logs grouped — we use a raw approach since
      // supabase JS doesn't support GROUP BY. We'll fetch distinct players
      // and count client-side, paginating to get all rows.
      // Better approach: fetch summary via RPC or just get distinct player rows.
      
      // Get all distinct players with their counts using a workaround:
      // Fetch player_id, player_name, team_abbr, game_date and aggregate client-side
      const allPlayers: Record<number, PlayerGameCount> = {};
      let offset = 0;
      const PAGE = 1000;
      
      while (true) {
        const { data: rows } = await supabase
          .from("player_recent_games")
          .select("player_id, player_name, team_abbr, game_date")
          .order("player_id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        
        if (!rows || rows.length === 0) break;
        
        for (const r of rows) {
          if (!allPlayers[r.player_id]) {
            allPlayers[r.player_id] = {
              player_name: r.player_name || `Player ${r.player_id}`,
              team_abbr: r.team_abbr,
              game_count: 0,
              earliest: r.game_date,
              latest: r.game_date,
            };
          }
          const p = allPlayers[r.player_id];
          p.game_count++;
          if (r.game_date < p.earliest) p.earliest = r.game_date;
          if (r.game_date > p.latest) p.latest = r.game_date;
        }
        
        if (rows.length < PAGE) break;
        offset += PAGE;
      }
      
      return Object.values(allPlayers);
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !data) return null;

  const totalPlayers = data.length;
  const criticalPlayers = data.filter(p => p.game_count < 10);
  const lowPlayers = data.filter(p => p.game_count >= 10 && p.game_count < 20);
  const healthyPlayers = data.filter(p => p.game_count >= 20);

  // Filter
  let filtered = data;
  if (filterMode === "critical") filtered = criticalPlayers;
  else if (filterMode === "low") filtered = [...criticalPlayers, ...lowPlayers];

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(p =>
      p.player_name.toLowerCase().includes(q) ||
      (p.team_abbr && p.team_abbr.toLowerCase().includes(q))
    );
  }

  // Sort
  filtered.sort((a, b) => {
    let cmp = 0;
    if (sortField === "game_count") cmp = a.game_count - b.game_count;
    else cmp = a.player_name.localeCompare(b.player_name);
    return sortAsc ? cmp : -cmp;
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(field === "game_count"); }
  };

  return (
    <Card className={criticalPlayers.length > 5 ? "border-red-500/30" : "border-border"}>
      <CardContent className="pt-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Data Quality — Game Logs
          </h3>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded(!expanded)}
            className="h-7 text-xs"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Collapse" : "Details"}
          </Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-bold text-green-500">{healthyPlayers.length}</div>
            <div className="text-[10px] text-muted-foreground">≥20 games</div>
          </div>
          <div>
            <div className="text-lg font-bold text-yellow-500">{lowPlayers.length}</div>
            <div className="text-[10px] text-muted-foreground">10-19 games</div>
          </div>
          <div>
            <div className="text-lg font-bold text-red-500">{criticalPlayers.length}</div>
            <div className="text-[10px] text-muted-foreground">&lt;10 games</div>
          </div>
        </div>

        <div className="text-[10px] text-muted-foreground text-center">
          {totalPlayers} total players tracked
        </div>

        {/* Expanded detail view */}
        {expanded && (
          <div className="space-y-2 pt-1 border-t border-border/30">
            {/* Filter chips */}
            <div className="flex gap-1.5 flex-wrap">
              {(["critical", "low", "all"] as FilterMode[]).map(mode => (
                <Badge
                  key={mode}
                  variant={filterMode === mode ? "default" : "outline"}
                  className="text-[10px] cursor-pointer"
                  onClick={() => setFilterMode(mode)}
                >
                  {mode === "critical" ? "🔴 Critical (<10)" : mode === "low" ? "🟡 Low (<20)" : "All"}
                </Badge>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Search player or team..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 text-xs pl-7"
              />
            </div>

            {/* Table */}
            <div className="max-h-80 overflow-y-auto rounded border border-border/50">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border/30">
                    <th
                      className="text-left p-1.5 cursor-pointer hover:text-primary"
                      onClick={() => toggleSort("player_name")}
                    >
                      Player {sortField === "player_name" && (sortAsc ? "↑" : "↓")}
                    </th>
                    <th className="text-left p-1.5 w-12">Team</th>
                    <th
                      className="text-right p-1.5 cursor-pointer hover:text-primary w-16"
                      onClick={() => toggleSort("game_count")}
                    >
                      Games {sortField === "game_count" && (sortAsc ? "↑" : "↓")}
                    </th>
                    <th className="text-right p-1.5 w-20">Latest</th>
                    <th className="text-center p-1.5 w-8">⚠</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 100).map((p, i) => (
                    <tr key={i} className="border-b border-border/10 hover:bg-muted/30">
                      <td className="p-1.5 font-medium truncate max-w-[140px]">{p.player_name}</td>
                      <td className="p-1.5 text-muted-foreground">{p.team_abbr || "—"}</td>
                      <td className="p-1.5 text-right font-mono">
                        <span className={
                          p.game_count < 10 ? "text-red-500 font-bold" :
                          p.game_count < 20 ? "text-yellow-500" :
                          "text-foreground"
                        }>
                          {p.game_count}
                        </span>
                      </td>
                      <td className="p-1.5 text-right text-muted-foreground">{p.latest.slice(5)}</td>
                      <td className="p-1.5 text-center">
                        {p.game_count < 10 ? (
                          <AlertTriangle className="h-3 w-3 text-red-500 mx-auto" />
                        ) : p.game_count < 20 ? (
                          <AlertTriangle className="h-3 w-3 text-yellow-500 mx-auto" />
                        ) : (
                          <CheckCircle className="h-3 w-3 text-green-500 mx-auto" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > 100 && (
                <p className="text-[10px] text-muted-foreground text-center py-1">
                  Showing 100 of {filtered.length}
                </p>
              )}
              {filtered.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No players match</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
