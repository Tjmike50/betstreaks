import { useNavigate } from "react-router-dom";
import { ArrowLeft, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Streak } from "@/types/streak";
import { getStatFriendlyLabel } from "@/lib/comboStats";

interface StreakDetailHeaderProps {
  streak: Streak | null;
  isLoading: boolean;
  isStarred: boolean;
  onToggleStar: () => void;
}

export function StreakDetailHeader({
  streak,
  isLoading,
  isStarred,
  onToggleStar,
}: StreakDetailHeaderProps) {
  const navigate = useNavigate();

  const getTitle = () => {
    if (!streak) return "Loading...";
    const isTeam = streak.entity_type === "team";
    const name = isTeam ? streak.team_abbr || streak.player_name : streak.player_name;
    const operator = streak.stat === "PTS_U" ? "≤" : "≥";
    const statLabel = getStatFriendlyLabel(streak.stat);
    return `${name} — ${statLabel} ${operator} ${streak.threshold}`;
  };

  return (
    <header className="px-4 py-4 border-b border-border">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(-1)}
        className="mb-3 -ml-2 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back
      </Button>

      {isLoading ? (
        <Skeleton className="h-8 w-64" />
      ) : (
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-foreground">{getTitle()}</h1>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={onToggleStar}
            aria-label={isStarred ? "Remove from watchlist" : "Add to watchlist"}
          >
            <Star
              className={`h-6 w-6 transition-colors ${
                isStarred
                  ? "fill-streak-gold text-streak-gold"
                  : "text-muted-foreground hover:text-streak-gold"
              }`}
            />
          </Button>
        </div>
      )}
    </header>
  );
}
