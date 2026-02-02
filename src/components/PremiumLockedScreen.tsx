import { Link } from "react-router-dom";
import { Lock, Zap, BarChart3, Trophy, Heart, TrendingUp, Users, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PremiumLockedScreenProps {
  isLoggedIn: boolean;
  className?: string;
}

const premiumFeatures = [
  { icon: Zap, text: "Real-time streak alerts (PRA, PR, PA)" },
  { icon: BarChart3, text: "Last 10 / 15 / 20 game splits" },
  { icon: Trophy, text: "Best plays of the day (AI ranked)" },
  { icon: Heart, text: "Save favorite players" },
  { icon: TrendingUp, text: "Historical matchup trends" },
  { icon: Users, text: "Player combo streaks" },
  { icon: Target, text: "Double-Double & Triple-Double tracking" },
];

export function PremiumLockedScreen({
  isLoggedIn,
  className,
}: PremiumLockedScreenProps) {
  return (
    <div className={cn("min-h-screen bg-background flex flex-col items-center justify-center p-6 pb-24", className)}>
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

        {/* Headline */}
        <div className="space-y-3">
          <h1 className="text-2xl font-bold">Stop guessing. Start catching streaks early.</h1>
        </div>

        {/* Free vs Premium comparison */}
        <div className="space-y-2 text-left bg-card border border-border rounded-lg p-4">
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">Free users</span> see what already happened.
          </p>
          <p className="text-sm">
            <span className="text-yellow-500 font-medium">Premium users</span> see what's building right now.
          </p>
        </div>

        {/* Premium Features List */}
        <div className="text-left space-y-3">
          <p className="text-sm font-semibold text-muted-foreground">What Premium unlocks:</p>
          <ul className="space-y-2">
            {premiumFeatures.map((feature, index) => (
              <li key={index} className="flex items-center gap-3 text-sm">
                <feature.icon className="h-4 w-4 text-yellow-500 shrink-0" />
                <span>{feature.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Pricing */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-2">
          <p className="text-2xl font-bold">$10 <span className="text-base font-normal text-muted-foreground">/ month</span></p>
          <p className="text-sm text-muted-foreground">or</p>
          <p className="text-lg font-semibold">
            $60 <span className="text-sm font-normal text-muted-foreground">/ year</span>
            <Badge variant="secondary" className="ml-2 bg-green-500/20 text-green-400 border-green-500/30">
              save 50%
            </Badge>
          </p>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col gap-3">
          {isLoggedIn ? (
            <Button asChild size="lg" className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
              <Link to="/premium">Upgrade to Premium</Link>
            </Button>
          ) : (
            <Button asChild size="lg" className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
              <Link to="/auth">Log in to Upgrade</Link>
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Back to Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
