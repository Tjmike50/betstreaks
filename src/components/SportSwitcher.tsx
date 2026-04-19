import { Check, ChevronDown } from "lucide-react";
import { useSport } from "@/contexts/SportContext";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SportSwitcherProps {
  /** Compact = pill button (used in mobile header). Full = wider button (sidebar). */
  variant?: "compact" | "full";
  className?: string;
}

export function SportSwitcher({ variant = "full", className }: SportSwitcherProps) {
  const { config, setSport, availableSports } = useSport();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Active sport: ${config.name}. Tap to switch.`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card/60 backdrop-blur-sm hover:border-primary/50 hover:bg-card transition-colors",
            variant === "compact" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
            className,
          )}
        >
          <span aria-hidden>{config.emoji}</span>
          <span className="font-semibold text-foreground">{config.shortName}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        {availableSports.map((s) => {
          const isActive = s.key === config.key;
          return (
            <DropdownMenuItem
              key={s.key}
              onSelect={() => setSport(s.key)}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden>{s.emoji}</span>
                <span className="font-medium">{s.name}</span>
              </span>
              {isActive && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
