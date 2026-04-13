import { useState } from "react";
import { X, Crown } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";

const STORAGE_KEY = "playoff_banner_dismissed";

export function EarlyAccessBanner() {
  const [isDismissed, setIsDismissed] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === "true";
  });
  const { isPremium, isLoading } = usePremiumStatus();

  if (isDismissed || isLoading || isPremium) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setIsDismissed(true);
  };

  return (
    <div className="bg-secondary/80 backdrop-blur-sm border-b border-border px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <Link to="/premium" className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-lg gradient-premium flex items-center justify-center shrink-0">
            <Crown className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              NBA Playoff Pass — $25
            </p>
            <p className="text-xs text-muted-foreground">
              Full access through the Finals • Promo codes accepted
            </p>
          </div>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={handleDismiss}
          aria-label="Dismiss banner"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
