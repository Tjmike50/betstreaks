import { Flame, TrendingUp, Calendar, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Streak } from "@/types/streak";
import { formatDistanceToNow } from "date-fns";

interface StreakStatsProps {
  streak: Streak;
  lastUpdated: string | null;
}

export function StreakStats({ streak, lastUpdated }: StreakStatsProps) {
  const isTeam = streak.entity_type === "team";

  // Build bet label
  const getBetLabel = () => {
    if (isTeam) {
      if (streak.stat === "ML") return "ML Wins";
      if (streak.stat === "PTS") return `Team PTS ≥ ${streak.threshold}`;
      if (streak.stat === "PTS_U") return `Team PTS ≤ ${streak.threshold}`;
    }
    const operator = streak.stat === "PTS_U" ? "≤" : "≥";
    return `${streak.stat} ${operator} ${streak.threshold}`;
  };

  // Format date helper
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Format relative time
  const formatRelativeTime = (timestamp: string | null) => {
    if (!timestamp) return "—";
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    } catch {
      return "—";
    }
  };

  // Calculate hit rates
  const getL10Pct = () => {
    if (streak.last10_hit_pct != null) return Math.round(streak.last10_hit_pct);
    if (streak.last10_games && streak.last10_games > 0) {
      return Math.round(((streak.last10_hits ?? 0) / streak.last10_games) * 100);
    }
    return null;
  };

  const getL5Pct = () => {
    if (streak.last5_hit_pct != null) return Math.round(streak.last5_hit_pct);
    if (streak.last5_games && streak.last5_games > 0) {
      return Math.round(((streak.last5_hits ?? 0) / streak.last5_games) * 100);
    }
    return null;
  };

  return (
    <>
      {/* Big Streak Badge */}
      <Card className="bg-card border-border">
        <CardContent className="p-6 flex flex-col items-center text-center gap-3">
          <div className="inline-flex items-center gap-2 bg-primary/15 text-primary px-4 py-2 rounded-lg">
            <span className="font-semibold text-lg">{getBetLabel()}</span>
          </div>
          <div className="flex items-center gap-3 text-streak-green">
            <Flame className="h-8 w-8" />
            <span className="text-3xl font-bold">
              {streak.streak_len} Game Streak
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Hit Rates Card */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Hit Rates
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-streak-blue">
                {Math.round(streak.season_win_pct)}%
              </div>
              <div className="text-xs text-muted-foreground">
                Season ({streak.season_wins}/{streak.season_games})
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-streak-blue">
                {getL10Pct() ?? "—"}%
              </div>
              <div className="text-xs text-muted-foreground">
                L10 ({streak.last10_hits ?? 0}/{streak.last10_games ?? 0})
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-streak-blue">
                {getL5Pct() ?? "—"}%
              </div>
              <div className="text-xs text-muted-foreground">
                L5 ({streak.last5_hits ?? 0}/{streak.last5_games ?? 0})
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dates Card */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Dates
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Streak Started</span>
              <span className="font-medium text-foreground">{formatDate(streak.streak_start)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Game</span>
              <span className="font-medium text-foreground">{formatDate(streak.last_game)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last Updated
              </span>
              <span className="font-medium text-foreground">
                {formatRelativeTime(lastUpdated)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
