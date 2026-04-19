import { Crown, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { useSport } from "@/contexts/SportContext";

export function PlayoffCTA() {
  const { isPremium, isLoading } = usePremiumStatus();
  const { sport } = useSport();

  // Playoff Pass is NBA-Playoffs specific — hide for other sports.
  if (isLoading || isPremium || sport !== "NBA") {
    return null;
  }

  return (
    <div className="mx-4 my-4">
      <div className="glass-card p-5 relative overflow-hidden">
        {/* Subtle accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1 gradient-premium" />

        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl gradient-premium flex items-center justify-center shrink-0 mt-0.5">
            <Crown className="h-5 w-5 text-primary-foreground" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-foreground mb-1">
              Unlock Playoff Access
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Full access through the Finals — AI slips, advanced stats, and real-time alerts for $25.
            </p>

            <div className="flex flex-wrap gap-2 mb-4">
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Zap className="h-3 w-3 text-primary" /> Unlimited AI Builder
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Zap className="h-3 w-3 text-primary" /> Advanced splits
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Zap className="h-3 w-3 text-primary" /> Real-time alerts
              </span>
            </div>

            <Button asChild size="sm" className="w-full sm:w-auto">
              <Link to="/premium">
                Get Playoff Pass — $25
              </Link>
            </Button>
            <p className="text-[10px] text-muted-foreground mt-2">
              Promo codes accepted at checkout
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
