import { Check, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { getTeamMeta } from "@/lib/nbaTeamMeta";
import { useGamesToday } from "@/hooks/useGamesToday";

function formatGameTime(gameTime: string | null, status: string | null): { label: string; isLive: boolean } {
  const s = (status || "").toLowerCase();
  if (s.includes("qtr") || s.includes("half") || s.includes("ot")) {
    return { label: status!, isLive: true };
  }
  if (s.includes("final")) {
    return { label: "Final", isLive: false };
  }
  if (gameTime && gameTime.includes("ET")) {
    return { label: gameTime.replace(/\s+ET$/, " ET"), isLive: false };
  }
  if (gameTime) {
    return { label: gameTime, isLive: false };
  }
  return { label: "", isLive: false };
}

interface Props {
  values: string[];
  onChange: (v: string[]) => void;
}

export function GameSelector({ values, onChange }: Props) {
  const { games, isLoading } = useGamesToday();

  const toggle = (id: string) => {
    onChange(
      values.includes(id) ? values.filter((v) => v !== id) : [...values, id]
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Games</Label>
        <div className="text-xs text-muted-foreground">Loading games...</div>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Games</Label>
        <div className="text-xs text-muted-foreground">No games scheduled today</div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        Games {values.length > 0 && `(${values.length} selected)`}
      </Label>
      <div className="grid grid-cols-2 gap-1.5">
        {games.map((game) => {
          const selected = values.includes(game.id);
          const awayMeta = game.away_team_abbr ? getTeamMeta(game.away_team_abbr) : null;
          const homeMeta = game.home_team_abbr ? getTeamMeta(game.home_team_abbr) : null;

          return (
            <button
              key={game.id}
              type="button"
              onClick={() => toggle(game.id)}
              className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all border ${
                selected
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-secondary/50 text-muted-foreground hover:bg-secondary border-transparent"
              }`}
            >
              <div className="flex items-center gap-1 flex-1 min-w-0">
                {awayMeta && (
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: `hsl(${awayMeta.color})` }}
                  />
                )}
                <span className="font-bold truncate">{game.away_team_abbr}</span>
                <span className="text-muted-foreground/50">@</span>
                {homeMeta && (
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: `hsl(${homeMeta.color})` }}
                  />
                )}
                <span className="font-bold truncate">{game.home_team_abbr}</span>
              </div>
              {selected && <Check className="h-3 w-3 shrink-0" />}
            </button>
          );
        })}
      </div>
      {values.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="text-[10px] text-muted-foreground hover:text-destructive"
        >
          Clear game selection
        </button>
      )}
    </div>
  );
}
