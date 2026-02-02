import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Bell, TrendingUp, TrendingDown, Star, CheckCheck, BellRing } from "lucide-react";
import { useAlerts } from "@/hooks/useAlerts";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Footer } from "@/components/Footer";
import { PremiumBadge } from "@/components/PremiumBadge";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import { PremiumLockedScreen } from "@/components/PremiumLockedScreen";
import { DataFreshnessIndicator } from "@/components/DataFreshnessIndicator";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday, parseISO, formatDistanceToNow } from "date-fns";
import type { StreakEvent } from "@/hooks/useAlerts";

type DayGroup = "Today" | "Yesterday" | "Older";

function getDayGroup(dateStr: string): DayGroup {
  const date = parseISO(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return "Older";
}

function groupEventsByDay(events: StreakEvent[]): Record<DayGroup, StreakEvent[]> {
  const groups: Record<DayGroup, StreakEvent[]> = {
    Today: [],
    Yesterday: [],
    Older: [],
  };

  for (const event of events) {
    const group = getDayGroup(event.created_at);
    groups[group].push(event);
  }

  return groups;
}

const AlertsPage = () => {
  const navigate = useNavigate();
  const { isPremium, isLoading: isPremiumLoading } = usePremiumStatus();
  const {
    events,
    isLoading: isAlertsLoading,
    isInWatchlist,
    isNewAlert,
    newAlertCount,
    markAllRead,
    markAsSeen,
  } = useAlerts();
  
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);

  // Show loading skeleton while checking premium status
  if (isPremiumLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col pb-20">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
          <div className="px-4 py-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-6 w-20" />
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-4">
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  // Show premium lock screen for non-premium users
  if (!isPremium) {
    return <PremiumLockedScreen />;
  }

  // Mark alerts as seen when page opens
  useEffect(() => {
    // Small delay to let user see the NEW badges briefly
    const timer = setTimeout(() => {
      markAsSeen();
    }, 2000);
    return () => clearTimeout(timer);
  }, [markAsSeen]);

  // Filter by watchlist if enabled
  const filteredEvents = watchlistOnly
    ? events.filter(isInWatchlist)
    : events;

  const groupedEvents = groupEventsByDay(filteredEvents);
  const dayGroups: DayGroup[] = ["Today", "Yesterday", "Older"];

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

  const getRelativeTime = (dateStr: string) => {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true });
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
              {newAlertCount > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {newAlertCount > 99 ? "99+" : newAlertCount} new
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllRead}
              className="text-muted-foreground"
            >
              <CheckCheck className="h-4 w-4 mr-1" />
              Mark all read
            </Button>
          </div>
          
          {/* Watchlist filter */}
          <div className="flex items-center gap-2 mt-3">
            <Star className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Watchlist only</span>
            <Switch
              checked={watchlistOnly}
              onCheckedChange={setWatchlistOnly}
            />
          </div>
          
          {/* Push Notifications - Premium Feature */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Push notifications</span>
              <PremiumBadge />
            </div>
            <Switch
              checked={false}
              onCheckedChange={() => setShowPremiumModal(true)}
            />
          </div>
          
          {/* Data Freshness Indicator */}
          <div className="mt-3 pt-3 border-t border-border">
            <DataFreshnessIndicator />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-4">
        {isAlertsLoading ? (
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
            {dayGroups.map((dayGroup) => {
              const dayEvents = groupedEvents[dayGroup];
              if (dayEvents.length === 0) return null;

              return (
                <div key={dayGroup}>
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3">
                    {dayGroup}
                  </h2>
                  <div className="space-y-2">
                    {dayEvents.map((event) => {
                      const isNew = isNewAlert(event);
                      
                      return (
                        <button
                          key={event.id}
                          onClick={() => handleAlertClick(event)}
                          className={cn(
                            "w-full text-left bg-card border rounded-lg p-3 hover:bg-accent/50 transition-colors",
                            isNew
                              ? "border-primary/50 bg-primary/5"
                              : "border-border"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              {/* Event type badge + NEW + name */}
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
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
                                {isNew && (
                                  <Badge className="text-xs bg-primary text-primary-foreground">
                                    NEW
                                  </Badge>
                                )}
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

                            {/* Relative time */}
                            <div className="text-xs text-muted-foreground whitespace-nowrap">
                              {getRelativeTime(event.created_at)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <Footer />
      
      <PremiumLockModal 
        open={showPremiumModal} 
        onOpenChange={setShowPremiumModal} 
      />
    </div>
  );
};

export default AlertsPage;
