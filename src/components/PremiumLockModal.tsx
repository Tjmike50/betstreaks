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
import { Crown, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PremiumLockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PREMIUM_FEATURES = [
  "Player combos (PTS+AST, PTS+REB, PRA, etc.)",
  "Last 10 / 15 / 20 game splits",
  "Real-time streak alerts",
  "Best plays of the day (AI ranked)",
  "Save favorite players",
  "Double-Double & Triple-Double tracking",
  "Historical matchup trends",
];

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
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-500/20">
            <Crown className="h-6 w-6 text-yellow-500" />
          </div>
          <DialogTitle className="text-center">
            Upgrade to Premium
          </DialogTitle>
          <DialogDescription className="text-center">
            Unlock all features and catch streaks early
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {PREMIUM_FEATURES.map((feature, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
                <Check className="h-3 w-3 text-primary" />
              </div>
              <span className="text-sm text-foreground">{feature}</span>
            </div>
          ))}
        </div>

        <div className="text-center py-2">
          <p className="text-sm text-muted-foreground">
            Starting at <span className="font-semibold text-foreground">$10/month</span> or{" "}
            <span className="font-semibold text-foreground">$60/year</span>
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
