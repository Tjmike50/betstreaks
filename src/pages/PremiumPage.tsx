import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Footer } from "@/components/Footer";
import { ArrowLeft, Crown, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePremiumWaitlist } from "@/hooks/usePremiumWaitlist";

const FEATURES = [
  "Unlimited watchlist across devices",
  "Watchlist-only instant alerts",
  "Advanced filters + best-bets boost",
];

export default function PremiumPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { markAsJoined } = usePremiumWaitlist();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValidEmail(email)) {
      toast({
        variant: "destructive",
        title: "Invalid email",
        description: "Please enter a valid email address.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Get current user if logged in
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase.from("premium_waitlist").insert({
        email: email.trim().toLowerCase(),
        user_id: user?.id ?? null,
        source: "app",
      });

      if (error) {
        // Check for unique constraint violation (error code 23505)
        if (error.code === "23505") {
          toast({
            title: "You're already on the list ✅",
            description: "We'll notify you when Premium launches.",
          });
          markAsJoined();
          setEmail("");
        } else {
          throw error;
        }
      } else {
        toast({
          title: "You're on the list ✅",
          description: "We'll notify you when Premium launches.",
        });
        markAsJoined();
        setEmail("");
      }
    } catch (error) {
      console.error("Waitlist error:", error);
      toast({
        variant: "destructive",
        title: "Something went wrong",
        description: "Please try again later.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1 -ml-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Crown className="h-6 w-6 text-yellow-500" />
              Premium
            </h1>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 pb-20">
        <Card className="bg-card border-border">
          <CardContent className="p-6 space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-foreground">
                BetStreaks Premium
              </h2>
              <p className="text-muted-foreground">Coming soon</p>
            </div>

            <div className="space-y-3">
              {FEATURES.map((feature, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
                    <Check className="h-3 w-3 text-primary" />
                  </div>
                  <span className="text-sm text-foreground">{feature}</span>
                </div>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              <Input
                type="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                className="bg-background"
              />
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={isSubmitting || !email.trim()}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Joining...
                  </>
                ) : (
                  "Join the waitlist"
                )}
              </Button>
            </form>

            <p className="text-xs text-muted-foreground text-center">
              No spam. We'll email you when Premium launches.
            </p>
          </CardContent>
        </Card>
      </main>

      <Footer />
    </div>
  );
}
