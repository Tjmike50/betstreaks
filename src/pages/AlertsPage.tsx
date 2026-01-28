import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bell, TrendingUp, TrendingDown, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWatchlist } from "@/hooks/useWatchlist";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Footer } from "@/components/Footer";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday, parseISO, differenceInDays } from "date-fns";

interface StreakEvent {
  id: string;
  sport: string;
  entity_type: string;
  player_id: number | null;
  player_name: string | null;
  team_abbr: string | null;
  stat: string;
  threshold: number;
  event_type: string;
  prev_streak_len: number | null;
  new_streak_len: number | null;
  last_game: string | null;
  created_at: string;
}

function getEventKey(event: StreakEvent): string {
  return `${event.entity_type}-${event.player_id}-${event.stat}-${event.threshold}`;
}

function formatDayGroup(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  const daysAgo = differenceInDays(new Date(), date);
  if (daysAgo < 7) return format(date, "EEEE"); // e.g., "Monday"
  return format(date, "MMM d"); // e.g., "Jan 15"
}

function groupEventsByDay(events: StreakEvent[]): Record<string, StreakEvent[]> {
  const groups: Record<string, StreakEvent[]> = {};
  
  for (const event of events) {
    const dayKey = formatDayGroup(event.created_at);
    if (!groups[dayKey]) {
      groups[dayKey] = [];
    }
    groups[dayKey].push(event);
  }
  
  return groups;
}

const AlertsPage = () => {
  const navigate = useNavigate();
  const { isStarred, offlineKeys, isAuthenticated } = useWatchlist();
  const [watchlistOnly, setWatchlistOnly] = useState(false);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["streak-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("streak_events")
        .select("*")
        .eq("sport", "NBA")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return data as StreakEvent[];
    },
  });

  // Filter by watchlist if enabled
  const filteredEvents = watchlistOnly
    ? events.filter((event) => {
        const key = getEventKey(event);
        // Check against offline keys or authed watchlist
        if (isAuthenticated) {
          return isStarred({
            entity_type: event.entity_type,
            player_id: event.player_id ?? 0,
            stat: event.stat,
            threshold: event.threshold,
          });
        }
        return offlineKeys.includes(key);
      })
    : events;

  const groupedEvents = groupEventsByDay(filteredEvents);
  const dayKeys = Object.keys(groupedEvents);

  const handleAlertClick = (event: StreakEvent) => {
    const params = new URLSearchParams({
      sport: event.sport,
      entity_type: event.entity_type,
      stat: event.stat,
      threshold: event.threshold.toString(),
    });

    if (event.entity_type === "player" && event.player_id) {
      params.set("player_id", event.player_id.toString());
    } else if (event.entity_type === "team" && event.team_abbr) {
      params.set("team_abbr", event.team_abbr);
      if (event.player_id) {
        params.set("player_id", event.player_id.toString());
      }
    }

    navigate(`/streak?${params.toString()}`);
  };

  const getBetLabel = (stat: string, threshold: number) => {
    const operator = stat === "PTS_U" ? "≤" : "≥";
    return `${stat} ${operator} ${threshold}`;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold">Alerts</h1>
            </div>
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Watchlist only</span>
              <Switch
                checked={watchlistOnly}
                onCheckedChange={setWatchlistOnly}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-4">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center py-12">
            <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {watchlistOnly
                ? "No alerts for your watchlist items"
                : "No recent alerts"}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {dayKeys.map((dayKey) => (
              <div key={dayKey}>
                <h2 className="text-sm font-semibold text-muted-foreground mb-3">
                  {dayKey}
                </h2>
                <div className="space-y-2">
                  {groupedEvents[dayKey].map((event) => (
                    <button
                      key={event.id}
                      onClick={() => handleAlertClick(event)}
                      className="w-full text-left bg-card border border-border rounded-lg p-3 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Event type badge + name */}
                          <div className="flex items-center gap-2 mb-1">
                            <Badge
                              className={cn(
                                "text-xs",
                                event.event_type === "extended"
                                  ? "bg-green-500/20 text-green-400 border-green-500/30"
                                  : "bg-red-500/20 text-red-400 border-red-500/30"
                              )}
                            >
                              {event.event_type === "extended" ? (
                                <TrendingUp className="h-3 w-3 mr-1" />
                              ) : (
                                <TrendingDown className="h-3 w-3 mr-1" />
                              )}
                              {event.event_type === "extended" ? "Extended" : "Broke"}
                            </Badge>
                            <span className="font-medium truncate">
                              {event.entity_type === "player"
                                ? event.player_name
                                : event.team_abbr}
                            </span>
                          </div>

                          {/* Bet label */}
                          <p className="text-sm text-muted-foreground">
                            {getBetLabel(event.stat, event.threshold)}
                          </p>

                          {/* Change description */}
                          <p className="text-sm mt-1">
                            {event.event_type === "extended" ? (
                              <span className="text-green-400">
                                {event.prev_streak_len} → {event.new_streak_len} games
                              </span>
                            ) : (
                              <span className="text-red-400">
                                Broke at {event.prev_streak_len} games
                              </span>
                            )}
                          </p>
                        </div>

                        {/* Last game date */}
                        {event.last_game && (
                          <div className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(parseISO(event.last_game), "MMM d")}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
};

export default AlertsPage;
