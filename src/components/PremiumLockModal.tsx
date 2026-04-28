import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PREMIUM_FEATURES_WITH_ICONS, PREMIUM_PRICING } from "@/lib/premiumFeatures";

interface PremiumLockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PremiumLockModal({ open, onOpenChange }: PremiumLockModalProps) {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsLoggedIn(!!user);
    });
  }, [open]);

  const handleUpgrade = () => {
    onOpenChange(false);
    navigate("/premium");
  };

  const handleLogin = () => {
    onOpenChange(false);
    navigate("/auth");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-premium/20">
            <Crown className="h-6 w-6 text-premium" />
          </div>
          <DialogTitle className="text-center text-xl">
            Unlock Premium
          </DialogTitle>
          <DialogDescription className="text-center">
            Everything BetStreaks offers, in one subscription.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 py-1">
          {PREMIUM_FEATURES_WITH_ICONS.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div key={index} className="flex items-center gap-3">
                <div className="flex-shrink-0 w-7 h-7 rounded-md bg-premium/15 flex items-center justify-center">
                  <Icon className="h-3.5 w-3.5 text-premium" />
                </div>
                <span className="text-sm text-foreground leading-snug">{feature.text}</span>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg border border-border bg-card/60 p-3 text-center">
          <p className="text-sm text-foreground">
            <span className="font-bold">{PREMIUM_PRICING.monthly.display}</span>
            <span className="text-muted-foreground">/{PREMIUM_PRICING.monthly.period}</span>
            <span className="text-muted-foreground mx-2">·</span>
            <span className="font-bold">{PREMIUM_PRICING.yearly.display}</span>
            <span className="text-muted-foreground">/{PREMIUM_PRICING.yearly.period}</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Cancel anytime. 21+. Please bet responsibly.
          </p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {isLoggedIn ? (
            <Button onClick={handleUpgrade} className="w-full">
              Upgrade to Premium
            </Button>
          ) : (
            <Button onClick={handleLogin} className="w-full">
              Log in to Upgrade
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="w-full"
          >
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
