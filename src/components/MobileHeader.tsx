import { SidebarTrigger } from "@/components/ui/sidebar";

export function MobileHeader() {
  return (
    <header className="sticky top-0 z-40 md:hidden flex items-center justify-between h-12 px-4 bg-background/90 backdrop-blur-md border-b border-border/50">
      <div className="flex items-center gap-2">
        <span className="text-lg">🔥</span>
        <span className="text-base font-bold text-foreground">BetStreaks</span>
        <span className="text-[10px] font-medium text-primary uppercase tracking-wider">Playoffs</span>
      </div>
      <SidebarTrigger className="h-8 w-8" />
    </header>
  );
}
