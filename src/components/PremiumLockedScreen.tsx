import { Link } from "react-router-dom";
import { Lock, Zap, Eye, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PremiumLockedScreenProps {
  isLoggedIn: boolean;
  className?: string;
}

const features = [
  { icon: Zap, text: "PRA / PR / PA streak alerts" },
  { icon: Eye, text: "Early streak detection" },
  { icon: TrendingUp, text: "Signals before lines move" },
];

export function PremiumLockedScreen({
  isLoggedIn,
  className,
}: PremiumLockedScreenProps) {
  return (
    <div className={cn("min-h-screen bg-background flex flex-col items-center justify-center p-6 pb-24", className)}>
      <div className="max-w-md w-full text-center space-y-6">
        {/* Lock Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center">
            <Lock className="h-8 w-8 text-yellow-500" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold">🔒 Premium Alerts</h1>

        {/* Subtitle */}
        <p className="text-muted-foreground">
          Real-time streak alerts are a Premium feature.
        </p>

        {/* Features List */}
        <div className="text-left space-y-3 bg-card border border-border rounded-lg p-4">
          <p className="text-sm font-medium text-muted-foreground">
            {isLoggedIn ? "Upgrade to unlock:" : "Log in and upgrade to unlock:"}
          </p>
          <ul className="space-y-3">
            {features.map((feature, index) => (
              <li key={index} className="flex items-center gap-3 text-sm">
                <feature.icon className="h-4 w-4 text-yellow-500 shrink-0" />
                <span>{feature.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col gap-3">
          {isLoggedIn ? (
            <Button asChild size="lg" className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
              <Link to="/premium">Upgrade to Premium</Link>
            </Button>
          ) : (
            <Button asChild size="lg" className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
              <Link to="/auth">Log in</Link>
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
