import { useState } from "react";
import { Flame, TrendingUp, Calendar, Clock, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Streak } from "@/types/streak";
import { formatDistanceToNow } from "date-fns";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { PremiumLockModal } from "@/components/PremiumLockModal";

interface StreakStatsProps {
  streak: Streak;
  lastUpdated: string | null;
}

export function StreakStats({ streak, lastUpdated }: StreakStatsProps) {
  const { isPremium } = usePremiumStatus();
  const [showPremiumModal, setShowPremiumModal] = useState(false);
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
  const getL5Pct = () => {
    if (streak.last5_hit_pct != null) return Math.round(streak.last5_hit_pct);
    if (streak.last5_games && streak.last5_games > 0) {
      return Math.round(((streak.last5_hits ?? 0) / streak.last5_games) * 100);
    }
    return null;
  };

  const getL10Pct = () => {
    if (streak.last10_hit_pct != null) return Math.round(streak.last10_hit_pct);
    if (streak.last10_games && streak.last10_games > 0) {
      return Math.round(((streak.last10_hits ?? 0) / streak.last10_games) * 100);
    }
    return null;
  };

  const handleLockedClick = () => {
    setShowPremiumModal(true);
  };

  // Locked placeholder component
  const LockedSplit = ({ label }: { label: string }) => (
    <button
      onClick={handleLockedClick}
      className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50 hover:bg-muted transition-colors w-full text-left"
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <Lock className="h-4 w-4 text-muted-foreground" />
    </button>
  );

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

      {/* Hit Rates / Splits Card */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Hit Rates
          </h3>
          <div className="space-y-2">
            {/* Season - always visible */}
            <div className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30">
              <span className="text-sm text-muted-foreground">Season</span>
              <span className="text-sm font-semibold text-streak-blue">
                {streak.season_wins}/{streak.season_games} ({Math.round(streak.season_win_pct)}%)
              </span>
            </div>

            {/* L5 - FREE */}
            <div className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30">
              <span className="text-sm text-muted-foreground">Last 5</span>
              <span className="text-sm font-semibold text-streak-blue">
                {streak.last5_hits ?? 0}/{streak.last5_games ?? 0} ({getL5Pct() ?? 0}%)
              </span>
            </div>

            {/* L10 - PREMIUM */}
            {isPremium ? (
              <div className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30">
                <span className="text-sm text-muted-foreground">Last 10</span>
                <span className="text-sm font-semibold text-streak-blue">
                  {streak.last10_hits ?? 0}/{streak.last10_games ?? 0} ({getL10Pct() ?? 0}%)
                </span>
              </div>
            ) : (
              <LockedSplit label="Last 10" />
            )}

            {/* L15 - PREMIUM */}
            {isPremium ? (
              <div className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30">
                <span className="text-sm text-muted-foreground">Last 15</span>
                <span className="text-sm font-semibold text-streak-blue">—</span>
              </div>
            ) : (
              <LockedSplit label="Last 15" />
            )}

            {/* L20 - PREMIUM */}
            {isPremium ? (
              <div className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30">
                <span className="text-sm text-muted-foreground">Last 20</span>
                <span className="text-sm font-semibold text-streak-blue">—</span>
              </div>
            ) : (
              <LockedSplit label="Last 20" />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Premium Modal */}
      <PremiumLockModal open={showPremiumModal} onOpenChange={setShowPremiumModal} />

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
