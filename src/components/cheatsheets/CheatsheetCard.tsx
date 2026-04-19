// =============================================================================
// CheatsheetCard — reusable category entry card for the Cheatsheets hub.
// =============================================================================
import { ArrowRight, LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export interface CheatsheetCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  /** Display "Coming soon" state and disable navigation. */
  comingSoon?: boolean;
  /** Optional accent color token (defaults to primary). */
  accent?: "primary" | "amber" | "emerald" | "violet";
}

const ACCENT_CLASSES: Record<NonNullable<CheatsheetCardProps["accent"]>, string> = {
  primary: "text-primary bg-primary/10",
  amber: "text-amber-400 bg-amber-400/10",
  emerald: "text-emerald-400 bg-emerald-400/10",
  violet: "text-violet-400 bg-violet-400/10",
};

export function CheatsheetCard({
  title,
  description,
  icon: Icon,
  to,
  comingSoon = false,
  accent = "primary",
}: CheatsheetCardProps) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      disabled={comingSoon}
      onClick={() => !comingSoon && navigate(to)}
      className={cn(
        "glass-card p-4 w-full text-left transition-all group",
        comingSoon
          ? "opacity-60 cursor-not-allowed"
          : "hover:border-primary/50 hover:scale-[1.01]",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
            ACCENT_CLASSES[accent],
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            {comingSoon && (
              <Badge variant="outline" className="text-[10px] font-medium">
                Coming soon
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground leading-snug">{description}</p>
        </div>
        {!comingSoon && (
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
        )}
      </div>
    </button>
  );
}
