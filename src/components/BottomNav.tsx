import { useLocation, useNavigate } from "react-router-dom";
import { Flame, Bell, BookOpen, Brain, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/hooks/useAlerts";

const navItems = [
  { path: "/", label: "Home", icon: Flame },
  { path: "/today", label: "Today", icon: Calendar },
  { path: "/ai-builder", label: "AI", icon: Brain, isHero: true },
  { path: "/cheatsheets", label: "Cheats", icon: BookOpen },
  { path: "/alerts", label: "Alerts", icon: Bell, showBadge: true },
];

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { newAlertCount } = useAlerts();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-background/90 backdrop-blur-lg border-t border-border/50 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          const isActive = item.path === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(item.path);
          const Icon = item.icon;
          const showBadge = item.showBadge && newAlertCount > 0 && !isActive;

          if (item.isHero) {
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="flex flex-col items-center justify-center flex-1 h-full relative -mt-3"
              >
                <div
                  className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-lg",
                    isActive
                      ? "gradient-primary shadow-primary/30"
                      : "bg-primary/15 hover:bg-primary/25"
                  )}
                >
                  <Icon className={cn("h-6 w-6", isActive ? "text-primary-foreground" : "text-primary")} />
                </div>
                <span className={cn(
                  "text-[10px] font-semibold mt-0.5",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}>
                  {item.label}
                </span>
              </button>
            );
          }

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
              </div>
              <span className="text-[10px] font-medium">{item.label}</span>
              {isActive && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
