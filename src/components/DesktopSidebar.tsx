import {
  Flame, Calendar, Brain, TrendingUp, Bookmark,
  Bell, Heart, Star, User, Crown, Shield,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { useAdmin } from "@/hooks/useAdmin";
import { useAlerts } from "@/hooks/useAlerts";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";

const mainNav = [
  { title: "Home", url: "/", icon: Flame },
  { title: "Today", url: "/today", icon: Calendar },
  { title: "AI Builder", url: "/ai-builder", icon: Brain },
  { title: "Best Bets", url: "/best-bets", icon: TrendingUp },
  { title: "Saved Slips", url: "/saved-slips", icon: Bookmark },
  { title: "Alerts", url: "/alerts", icon: Bell, hasBadge: true },
  { title: "Favorites", url: "/favorites", icon: Heart },
  { title: "Watchlist", url: "/watchlist", icon: Star },
  { title: "Account", url: "/account", icon: User },
  { title: "Premium", url: "/premium", icon: Crown },
];

export function DesktopSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { isAdmin } = useAdmin();
  const { newAlertCount } = useAlerts();
  const { isPremium } = usePremiumStatus();

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔥</span>
          {!collapsed && (
            <div>
              <h1 className="text-lg font-bold text-foreground leading-tight">BetStreaks</h1>
              <p className="text-[10px] font-medium text-primary uppercase tracking-wider">NBA Playoffs</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => {
                const active = isActive(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                    >
                      <NavLink
                        to={item.url}
                        end={item.url === "/"}
                        className="flex items-center gap-3"
                        activeClassName="bg-primary/10 text-primary font-medium"
                        onClick={handleNavClick}
                      >
                        <item.icon className={`h-4 w-4 shrink-0 ${item.title === "AI Builder" ? "text-primary" : ""}`} />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                    {item.hasBadge && newAlertCount > 0 && (
                      <SidebarMenuBadge className="bg-destructive text-destructive-foreground text-[10px]">
                        {newAlertCount > 99 ? "99+" : newAlertCount}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive("/admin")}
                    tooltip="Admin"
                  >
                    <NavLink
                      to="/admin/eval"
                      className="flex items-center gap-3"
                      activeClassName="bg-primary/10 text-primary font-medium"
                    >
                      <Shield className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>Admin</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {!isPremium && (
        <SidebarFooter className="p-3">
          {!collapsed ? (
            <button
              onClick={() => navigate("/premium")}
              className="glass-card p-3 w-full text-left hover:border-primary/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <Crown className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-semibold text-foreground">Playoff Pass</span>
              </div>
              <p className="text-xs text-muted-foreground">$25 through the Finals</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Promo codes accepted at checkout</p>
            </button>
          ) : (
            <button
              onClick={() => navigate("/premium")}
              className="flex items-center justify-center p-2 rounded-md hover:bg-primary/10 transition-colors"
            >
              <Crown className="h-4 w-4 text-amber-400" />
            </button>
          )}
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
