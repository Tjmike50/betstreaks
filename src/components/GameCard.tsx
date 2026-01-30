import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface GameCardProps {
  id: string;
  homeTeamAbbr: string | null;
  awayTeamAbbr: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string | null;
  gameTime: string | null;
}

export function GameCard({
  homeTeamAbbr,
  awayTeamAbbr,
  homeScore,
  awayScore,
  status,
  gameTime,
}: GameCardProps) {
  const navigate = useNavigate();

  const handleTeamClick = (teamAbbr: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!teamAbbr) return;
    // Navigate to home page with Teams tab and team filter
    navigate(`/?tab=teams&team=${teamAbbr}`);
  };

  const hasScores = homeScore !== null && awayScore !== null;
  const displayStatus = status || gameTime || "TBD";

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          {/* Teams */}
          <div className="flex items-center gap-2 text-lg font-semibold">
            <button
              onClick={(e) => handleTeamClick(awayTeamAbbr, e)}
              className={cn(
                "hover:text-primary transition-colors",
                awayTeamAbbr ? "cursor-pointer" : "cursor-default"
              )}
            >
              {awayTeamAbbr || "TBD"}
            </button>
            <span className="text-muted-foreground">@</span>
            <button
              onClick={(e) => handleTeamClick(homeTeamAbbr, e)}
              className={cn(
                "hover:text-primary transition-colors",
                homeTeamAbbr ? "cursor-pointer" : "cursor-default"
              )}
            >
              {homeTeamAbbr || "TBD"}
            </button>
          </div>

          {/* Score or Status */}
          <div className="text-right">
            {hasScores ? (
              <div className="flex flex-col items-end">
                <span className="text-lg font-bold tabular-nums">
                  {awayScore} - {homeScore}
                </span>
                <span className="text-xs text-muted-foreground">{displayStatus}</span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">{displayStatus}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
