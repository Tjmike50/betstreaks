import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
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

const getTeamLogoUrl = (teamAbbr: string | null) => {
  if (!teamAbbr) return null;
  // ESPN CDN for NBA team logos
  return `https://a.espncdn.com/i/teamlogos/nba/500/${teamAbbr.toLowerCase()}.png`;
};

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
    navigate(`/?tab=teams&team=${teamAbbr}`);
  };

  const hasScores = homeScore !== null && awayScore !== null;
  const displayStatus = status || gameTime || "TBD";

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          {/* Teams */}
          <div className="flex items-center gap-3">
            {/* Away Team */}
            <button
              onClick={(e) => handleTeamClick(awayTeamAbbr, e)}
              className={cn(
                "flex items-center gap-2 hover:opacity-80 transition-opacity",
                awayTeamAbbr ? "cursor-pointer" : "cursor-default"
              )}
            >
              <Avatar className="h-8 w-8">
                <AvatarImage 
                  src={getTeamLogoUrl(awayTeamAbbr)} 
                  alt={awayTeamAbbr || "Away team"} 
                />
                <AvatarFallback className="text-xs font-medium bg-muted">
                  {awayTeamAbbr?.slice(0, 2) || "?"}
                </AvatarFallback>
              </Avatar>
              <span className="text-base font-semibold">{awayTeamAbbr || "TBD"}</span>
            </button>

            <span className="text-muted-foreground text-sm">@</span>

            {/* Home Team */}
            <button
              onClick={(e) => handleTeamClick(homeTeamAbbr, e)}
              className={cn(
                "flex items-center gap-2 hover:opacity-80 transition-opacity",
                homeTeamAbbr ? "cursor-pointer" : "cursor-default"
              )}
            >
              <Avatar className="h-8 w-8">
                <AvatarImage 
                  src={getTeamLogoUrl(homeTeamAbbr)} 
                  alt={homeTeamAbbr || "Home team"} 
                />
                <AvatarFallback className="text-xs font-medium bg-muted">
                  {homeTeamAbbr?.slice(0, 2) || "?"}
                </AvatarFallback>
              </Avatar>
              <span className="text-base font-semibold">{homeTeamAbbr || "TBD"}</span>
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