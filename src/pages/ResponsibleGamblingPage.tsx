import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Footer } from "@/components/Footer";
import { ArrowLeft } from "lucide-react";

export default function ResponsibleGamblingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-4 py-4 border-b border-border flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Responsible Gambling
          </h1>
          <p className="text-xs text-muted-foreground">
            Last updated: January 2025
          </p>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 pb-20">
        <Card className="bg-card border-border">
          <CardContent className="p-6 space-y-6">
            {/* Important Notice - Emphasized */}
            <div className="space-y-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <h2 className="text-base font-semibold text-foreground">
                Important Notice
              </h2>
              <p className="text-sm text-foreground font-medium">
                BetStreaks is NOT a sportsbook and does not accept or facilitate bets.
              </p>
            </div>

            <div className="space-y-2">
              <h2 className="text-base font-semibold text-foreground">
                Information Only
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                All statistics, streaks, alerts, and analytics are provided for informational and entertainment purposes only. Nothing in the App should be considered betting advice.
              </p>
            </div>

            <div className="space-y-2">
              <h2 className="text-base font-semibold text-foreground">
                No Guarantees
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Sports outcomes are unpredictable. No streak, statistic, or trend guarantees future results.
              </p>
            </div>

            <div className="space-y-2">
              <h2 className="text-base font-semibold text-foreground">
                Bet Responsibly
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                If you choose to gamble:
                
• Only bet what you can afford to lose
• Do not chase losses
• Take breaks when needed
              </p>
            </div>

            {/* Problem Gambling Help - Highlighted */}
            <div className="space-y-3 p-4 bg-primary/10 border border-primary/20 rounded-lg">
              <h2 className="text-base font-semibold text-foreground">
                Problem Gambling Help
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                If you or someone you know is struggling with gambling:
              </p>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  U.S. National Problem Gambling Helpline
                </p>
                <a 
                  href="tel:1-800-426-2537"
                  className="block text-lg font-bold text-primary hover:underline"
                >
                  1-800-GAMBLER (1-800-426-2537)
                </a>
                <a 
                  href="https://www.ncpgambling.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-primary hover:underline"
                >
                  www.ncpgambling.org
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      <Footer />
    </div>
  );
}
