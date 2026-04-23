import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSport } from "@/contexts/SportContext";

interface GameCardProps {
  id: string;
  homeTeamAbbr: string | null;
  awayTeamAbbr: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string | null;
  gameTime: string | null;
}

/**
 * Sport-aware team logo URL. Falls back to ESPN CDN paths per league.
 */
function getTeamLogoUrl(sport: string, teamAbbr: string | null): string | null {
  if (!teamAbbr) return null;
  const abbr = teamAbbr.toLowerCase();
  switch (sport.toUpperCase()) {
    case "MLB":
      return `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr}.png`;
    case "WNBA":
      return `https://a.espncdn.com/i/teamlogos/wnba/500/${abbr}.png`;
    case "NBA":
    default:
      return `https://a.espncdn.com/i/teamlogos/nba/500/${abbr}.png`;
  }
}

type GameStatus = "final" | "live" | "scheduled";

const getGameStatus = (status: string | null, hasScores: boolean): GameStatus => {
  if (!status) return "scheduled";
  const statusLower = status.toLowerCase();
  
  if (statusLower.includes("final")) return "final";
  if (status.includes("ET") || status.includes(":")) return "scheduled";
  if (hasScores) return "live";
  
  return "scheduled";
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
  const { sport } = useSport();

  const handleTeamClick = (teamAbbr: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!teamAbbr) return;
    navigate(`/?tab=teams&team=${teamAbbr}`);
  };

  const hasScores = homeScore !== null && awayScore !== null;
  const gameStatus = getGameStatus(status, hasScores);
  const displayTime = gameTime || status || "TBD";

  return (
    <Card className="overflow-hidden transition-colors hover:bg-accent/50 active:bg-accent/70 cursor-pointer">
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
                  src={getTeamLogoUrl(sport, awayTeamAbbr) ?? undefined} 
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
                  src={getTeamLogoUrl(sport, homeTeamAbbr) ?? undefined} 
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
          <div className="text-right flex flex-col items-end gap-1">
            {gameStatus === "live" && (
              <Badge variant="destructive" className="text-xs px-2 py-0.5 animate-pulse">
                Live
              </Badge>
            )}
            
            {gameStatus === "final" && hasScores ? (
              <div className="flex flex-col items-end">
                <span className="text-xl font-bold tabular-nums">
                  {awayScore} - {homeScore}
                </span>
                <span className="text-xs text-muted-foreground font-medium">Final</span>
              </div>
            ) : gameStatus === "live" && hasScores ? (
              <div className="flex flex-col items-end">
                <span className="text-xl font-bold tabular-nums text-destructive">
                  {awayScore} - {homeScore}
                </span>
                <span className="text-xs text-muted-foreground">{status}</span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">{displayTime}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}