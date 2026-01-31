import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "early_access_banner_dismissed";

export function EarlyAccessBanner() {
  const [isDismissed, setIsDismissed] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === "true";
  });

  if (isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setIsDismissed(true);
  };

  return (
    <div className="bg-secondary/80 backdrop-blur-sm border-b border-border px-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            Early Access
          </p>
          <p className="text-xs text-muted-foreground">
            BetStreaks is in early access. Premium features are preview-only for now.
          </p>
        </div>
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
