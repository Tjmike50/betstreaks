import { Link } from "react-router-dom";
import { Lock, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PremiumLockedScreenProps {
  title?: string;
  description?: string;
  className?: string;
}

export function PremiumLockedScreen({
  title = "Alerts are Premium",
  description = "Unlock real-time streak alerts and \"new streak\" signals.",
  className,
}: PremiumLockedScreenProps) {
  return (
    <div className={cn("min-h-screen bg-background flex flex-col items-center justify-center p-6", className)}>
      <div className="max-w-md w-full text-center space-y-6">
        {/* Lock Icon with Premium Badge */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center">
            <Lock className="h-8 w-8 text-yellow-500" />
          </div>
          <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30 px-3 py-1">
            <Lock className="h-3 w-3 mr-1" />
            Premium Feature
          </Badge>
        </div>

        {/* Title and Description */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col gap-3">
          <Button asChild size="lg" className="w-full">
            <Link to="/premium">Upgrade to Premium</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Back to Home</Link>
          </Button>
        </div>

        {/* Blurred Preview Section */}
        <div className="pt-6">
          <p className="text-xs text-muted-foreground mb-3">Preview</p>
          <div className="space-y-2 blur-sm pointer-events-none select-none" aria-hidden="true">
            {/* Sample Alert Card 1 - Extended */}
            <Card className="p-3 text-left">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  Extended
                </Badge>
                <span className="font-medium text-sm">LeBron James</span>
              </div>
              <p className="text-xs text-muted-foreground">PTS ≥ 25</p>
              <p className="text-xs text-green-400 mt-1">8 → 9 games</p>
            </Card>

            {/* Sample Alert Card 2 - Broke */}
            <Card className="p-3 text-left">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="text-xs bg-red-500/20 text-red-400 border-red-500/30">
                  <TrendingDown className="h-3 w-3 mr-1" />
                  Broke
                </Badge>
                <span className="font-medium text-sm">Stephen Curry</span>
              </div>
              <p className="text-xs text-muted-foreground">3PM ≥ 3</p>
              <p className="text-xs text-red-400 mt-1">Broke at 12 games</p>
            </Card>

            {/* Sample Alert Card 3 - Extended */}
            <Card className="p-3 text-left">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  Extended
                </Badge>
                <span className="font-medium text-sm">Jayson Tatum</span>
              </div>
              <p className="text-xs text-muted-foreground">REB ≥ 7</p>
              <p className="text-xs text-green-400 mt-1">5 → 6 games</p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
