import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Flame, TrendingUp, Calendar, Star, Lock } from "lucide-react";
import type { Streak } from "@/types/streak";
import { getStatFriendlyLabel, isComboStat } from "@/lib/comboStats";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { PremiumLockModal } from "@/components/PremiumLockModal";

interface StreakCardProps {
  streak: Streak;
  isStarred?: boolean;
  onToggleStar?: (streak: Streak) => { added: boolean; limitReached: boolean } | void;
  showStarButton?: boolean;
}

export function StreakCard({ streak, isStarred, onToggleStar, showStarButton = true }: StreakCardProps) {
  const navigate = useNavigate();
  const { isPremium } = usePremiumStatus();
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  
  const isTeam = streak.entity_type === "team";
  const isCombo = isComboStat(streak.stat);
  const isLocked = isCombo && !isPremium;

  const handleClick = () => {
    // If locked combo, show premium modal instead of navigating
    if (isLocked) {
      setShowPremiumModal(true);
      return;
    }
    
    const params = new URLSearchParams({
      sport: streak.sport,
      entity_type: streak.entity_type,
      stat: streak.stat,
      threshold: streak.threshold.toString(),
    });
    if (streak.player_id) params.set("player_id", streak.player_id.toString());
    if (streak.team_abbr) params.set("team_abbr", streak.team_abbr);
    navigate(`/streak?${params.toString()}`);
  };

  const handleStarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // If locked combo, show premium modal instead of starring
    if (isLocked) {
      setShowPremiumModal(true);
      return;
    }
    
    onToggleStar?.(streak);
  };

  const formatDate = (dateStr: string) => {
    return dateStr;
  };

  // Get display name: for teams, prefer team_abbr
  const displayName = isTeam
    ? streak.team_abbr || streak.player_name
    : streak.player_name;

  // Check if qualifies as "Best Bet" - don't show for locked combos
  const isBestBet = !isLocked && streak.season_win_pct >= 55 && streak.streak_len >= 3;

  // Get bet label: special formatting for teams, combos, and stats
  const getBetLabel = () => {
    if (isTeam) {
      if (streak.stat === "ML") {
        return "ML Wins";
      }
      if (streak.stat === "PTS") {
        return `Team PTS ≥ ${streak.threshold}`;
      }
      if (streak.stat === "PTS_U") {
        return `Team PTS ≤ ${streak.threshold}`;
      }
    }
    
    // For locked combos, only show the stat label without threshold
    if (isLocked) {
      return getStatFriendlyLabel(streak.stat);
    }
    
    // Use friendly label for combos (e.g., "PTS+AST 18+") or regular stats
    const statLabel = getStatFriendlyLabel(streak.stat);
    return `${statLabel} ${streak.threshold}+`;
  };

  // Render locked combo card
  if (isLocked) {
    return (
      <>
        <Card
          onClick={handleClick}
          className="bg-card border-border hover:border-primary/50 transition-all duration-200 cursor-pointer active:scale-[0.98]"
        >
          <CardContent className="p-4 space-y-3">
            {/* Header: Name + Team Badge + Star */}
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-foreground truncate flex-1">
                {displayName}
              </h3>
              {!isTeam && streak.team_abbr && (
                <Badge
                  variant="secondary"
                  className="bg-secondary text-secondary-foreground shrink-0 text-xs"
                >
                  {streak.team_abbr}
                </Badge>
              )}
              {showStarButton && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={handleStarClick}
                  aria-label="Premium feature"
                >
                  <Lock className="h-5 w-5 text-muted-foreground" />
                </Button>
              )}
            </div>

            {/* Combo Label */}
            <div className="inline-flex items-center gap-2 bg-yellow-500/15 text-yellow-600 dark:text-yellow-500 px-3 py-1.5 rounded-lg">
              <Lock className="h-4 w-4" />
              <span className="font-semibold">{getBetLabel()}</span>
            </div>

            {/* Locked Content Placeholder */}
            <div className="py-4 px-3 rounded-lg bg-muted/30 border border-dashed border-border">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Lock className="h-4 w-4" />
                <span className="text-sm">Premium — Unlock combos & advanced splits</span>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <PremiumLockModal open={showPremiumModal} onOpenChange={setShowPremiumModal} />
      </>
    );
  }

  // Regular unlocked card
  return (
    <Card
      onClick={handleClick}
      className="bg-card border-border hover:border-primary/50 transition-all duration-200 cursor-pointer active:scale-[0.98]"
    >
      <CardContent className="p-4 space-y-3">
        {/* Header: Name + Team Badge (only for players) + Best Bet Badge + Star */}
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-bold text-foreground truncate flex-1">
            {displayName}
          </h3>
          {!isTeam && streak.team_abbr && (
            <Badge
              variant="secondary"
              className="bg-secondary text-secondary-foreground shrink-0 text-xs"
            >
              {streak.team_abbr}
            </Badge>
          )}
          {isBestBet && (
            <Badge className="bg-streak-gold text-background shrink-0 text-xs gap-1">
              <Star className="h-3 w-3 fill-current" />
              Best Bet
            </Badge>
          )}
          {showStarButton && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleStarClick}
              aria-label={isStarred ? "Remove from watchlist" : "Add to watchlist"}
            >
              <Star
                className={`h-5 w-5 transition-colors ${
                  isStarred
                    ? "fill-streak-gold text-streak-gold"
                    : "text-muted-foreground hover:text-streak-gold"
                }`}
              />
            </Button>
          )}
        </div>

        {/* Bet Label */}
        <div className="inline-flex items-center gap-2 bg-primary/15 text-primary px-3 py-1.5 rounded-lg">
          <span className="font-semibold">{getBetLabel()}</span>
        </div>

        {/* Stats Grid */}
        <div className="space-y-2 text-sm">
          {/* Active Streak */}
          <div className="flex items-center gap-2 text-streak-green">
            <Flame className="h-4 w-4" />
            <span className="font-medium">
              Active streak: {streak.streak_len} games
            </span>
          </div>

          {/* Season Hit Rate */}
          <div className="flex items-center gap-2 text-streak-blue">
            <TrendingUp className="h-4 w-4" />
            <span>
              Season: {Math.round(streak.season_win_pct)}%{" "}
              <span className="text-muted-foreground">
                ({streak.season_wins}/{streak.season_games})
              </span>
            </span>
          </div>

          {/* Last 10 Hit Rate */}
          {streak.last10_games > 0 && (
            <div className="flex items-center gap-2 text-streak-blue">
              <TrendingUp className="h-4 w-4" />
              <span>
                L10: {streak.last10_hit_pct != null ? Math.round(streak.last10_hit_pct) : Math.round((streak.last10_hits / streak.last10_games) * 100)}%{" "}
                <span className="text-muted-foreground">
                  ({streak.last10_hits}/{streak.last10_games})
                </span>
              </span>
            </div>
          )}

          {/* Last 5 Hit Rate */}
          {streak.last5_games > 0 && (
            <div className="flex items-center gap-2 text-streak-blue">
              <TrendingUp className="h-4 w-4" />
              <span>
                L5: {streak.last5_hit_pct != null ? Math.round(streak.last5_hit_pct) : Math.round((streak.last5_hits / streak.last5_games) * 100)}%{" "}
                <span className="text-muted-foreground">
                  ({streak.last5_hits}/{streak.last5_games})
                </span>
              </span>
            </div>
          )}

          {/* Last Game */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>Last game: {formatDate(streak.last_game)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
