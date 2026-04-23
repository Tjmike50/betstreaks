import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { NbaPropRow } from "@/hooks/useNbaProps";
import type { LineMovementRow } from "@/hooks/useLineMovement";
import { movementKey } from "@/hooks/useLineMovement";

const MARKET_LABELS: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers",
  player_blocks: "Blocks",
  player_steals: "Steals",
  player_points_rebounds_assists: "PRA",
  player_points_rebounds: "Pts+Reb",
  player_points_assists: "Pts+Ast",
  player_rebounds_assists: "Reb+Ast",
  player_double_double: "Double-Double",
};

function formatOdds(odds: number | null): string {
  if (odds == null) return "—";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function MoveIndicator({ amount }: { amount: number | null }) {
  if (amount == null || Math.abs(amount) < 0.01) {
    return <Minus className="h-3 w-3 text-muted-foreground" />;
  }
  if (amount > 0) {
    return <TrendingUp className="h-3 w-3 text-green-400" />;
  }
  return <TrendingDown className="h-3 w-3 text-red-400" />;
}

interface Props {
  props: NbaPropRow[];
  movementIndex: Map<string, LineMovementRow>;
}

export function GamePropsPanel({ props, movementIndex }: Props) {
  if (props.length === 0) return null;

  // Group by player
  const byPlayer = new Map<string, NbaPropRow[]>();
  for (const p of props) {
    const existing = byPlayer.get(p.player_id) ?? [];
    existing.push(p);
    byPlayer.set(p.player_id, existing);
  }

  return (
    <div className="px-4 pb-3 space-y-3">
      {Array.from(byPlayer.entries()).map(([playerId, playerProps]) => {
        const playerName = playerProps[0].player_name;
        return (
          <div key={playerId} className="rounded-lg bg-secondary/50 p-3 space-y-2">
            <p className="text-sm font-semibold text-foreground">{playerName}</p>
            <div className="space-y-1.5">
              {playerProps.map((prop) => {
                const mKey = movementKey(prop.event_id, prop.player_id, prop.market_type);
                const movement = movementIndex.get(mKey);
                const label = MARKET_LABELS[prop.market_type] ?? prop.market_type;

                return (
                  <div
                    key={`${prop.event_id}-${prop.player_id}-${prop.market_type}`}
                    className="grid grid-cols-[1fr_auto] gap-2 items-start text-xs"
                  >
                    {/* Left: market + consensus + best lines */}
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground">{label}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {prop.line != null ? prop.line : "—"}
                        </span>
                        {prop.book_count != null && prop.book_count > 0 && (
                          <span className="text-muted-foreground/70">
                            ({prop.book_count} {prop.book_count === 1 ? "book" : "books"})
                          </span>
                        )}
                      </div>

                      {/* Best over / under */}
                      <div className="flex gap-3 text-muted-foreground">
                        {prop.best_over_odds_american != null && (
                          <span>
                            O {prop.best_over_line ?? prop.line}{" "}
                            <span className="text-green-400 font-medium">
                              {formatOdds(prop.best_over_odds_american)}
                            </span>
                            {prop.best_over_sportsbook_name && (
                              <span className="text-muted-foreground/60 ml-0.5">
                                {prop.best_over_sportsbook_name}
                              </span>
                            )}
                          </span>
                        )}
                        {prop.best_under_odds_american != null && (
                          <span>
                            U {prop.best_under_line ?? prop.line}{" "}
                            <span className="text-red-400 font-medium">
                              {formatOdds(prop.best_under_odds_american)}
                            </span>
                            {prop.best_under_sportsbook_name && (
                              <span className="text-muted-foreground/60 ml-0.5">
                                {prop.best_under_sportsbook_name}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: movement */}
                    {movement && (
                      <div className="flex items-center gap-1 text-right whitespace-nowrap pt-0.5">
                        <MoveIndicator amount={movement.move_amount} />
                        <div className="flex flex-col items-end leading-tight">
                          <span className="text-muted-foreground/70">
                            {movement.opening_line != null ? movement.opening_line : "—"} →{" "}
                            {movement.current_line != null ? movement.current_line : "—"}
                          </span>
                          {movement.move_amount != null && Math.abs(movement.move_amount) >= 0.01 && (
                            <span
                              className={
                                movement.move_amount > 0
                                  ? "text-green-400 font-medium"
                                  : "text-red-400 font-medium"
                              }
                            >
                              {movement.move_amount > 0 ? "+" : ""}
                              {movement.move_amount.toFixed(1)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
