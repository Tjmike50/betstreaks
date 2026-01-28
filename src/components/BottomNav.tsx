import { useLocation, useNavigate } from "react-router-dom";
import { Flame, Star, Trophy, Bell, Crown, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/hooks/useAlerts";
import { usePremiumWaitlist } from "@/hooks/usePremiumWaitlist";

const navItems = [
  { path: "/", label: "Streaks", icon: Flame },
  { path: "/best-bets", label: "Best Bets", icon: Trophy },
  { path: "/alerts", label: "Alerts", icon: Bell, showBadge: true },
  { path: "/watchlist", label: "Watchlist", icon: Star },
  { path: "/premium", label: "Premium", icon: Crown, showPremiumDot: true },
  { path: "/account", label: "Account", icon: User },
];

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { newAlertCount } = useAlerts();
  const { hasJoinedWaitlist } = usePremiumWaitlist();

  // Don't show on player detail pages
  if (location.pathname.startsWith("/player/")) {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border">
      <div className="flex items-center justify-around h-14">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          const showBadge = item.showBadge && newAlertCount > 0 && !isActive;
          const showPremiumDot = item.showPremiumDot && !hasJoinedWaitlist && !isActive;

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors relative",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="relative">
                <Icon className={cn("h-5 w-5", isActive && "fill-primary/20")} />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] flex items-center justify-center bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full px-1">
                    {newAlertCount > 99 ? "99+" : newAlertCount}
                  </span>
                )}
                {showPremiumDot && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-yellow-500 rounded-full" />
                )}
              </div>
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
