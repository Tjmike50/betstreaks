import { SidebarTrigger } from "@/components/ui/sidebar";
import { SportSwitcher } from "@/components/SportSwitcher";
import { useSport } from "@/contexts/SportContext";

export function MobileHeader() {
  const { config } = useSport();
  return (
    <header className="sticky top-0 z-40 md:hidden flex items-center justify-between h-12 px-4 bg-background/90 backdrop-blur-md border-b border-border/50">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-lg" aria-hidden>🔥</span>
        <span className="text-base font-bold text-foreground">BetStreaks</span>
        <span className="text-[10px] font-medium text-primary uppercase tracking-wider truncate">
          {config.tagline}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <SportSwitcher variant="compact" />
        <SidebarTrigger className="h-8 w-8" />
      </div>
    </header>
  );
}
