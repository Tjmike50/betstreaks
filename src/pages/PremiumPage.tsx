import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Footer } from "@/components/Footer";
import { ArrowLeft, Crown, Check, Loader2, ExternalLink, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { Badge } from "@/components/ui/badge";
import { PREMIUM_FEATURES, PREMIUM_PRICING } from "@/lib/premiumFeatures";
import { analytics } from "@/lib/analytics";
import { useSport } from "@/contexts/SportContext";

const PRICE_IDS = {
  monthly: "price_1SyJVfF2kOU6awRkLbvUGeLl",
  yearly: "price_1SyJcpF2kOU6awRk2uaH9xum",
  playoff: "price_1TLqRuF2kOU6awRkIPRlo3NI",
};

const MAX_CONFIRM_RETRIES = 3;
const CONFIRM_RETRY_DELAY = 2000;

export default function PremiumPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const { isPremium, isLoading: isPremiumLoading, refetch } = usePremiumStatus();
  const { sport } = useSport();
  
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState<"monthly" | "yearly" | "playoff" | null>(null);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmFailed, setConfirmFailed] = useState(false);

  // Track page view
  useEffect(() => {
    analytics.viewPremiumPage();
  }, []);

  // Post-checkout confirmation with polling
  const confirmPremiumStatus = useCallback(async () => {
    setIsConfirming(true);
    setConfirmFailed(false);

    try {
      for (let attempt = 0; attempt < MAX_CONFIRM_RETRIES; attempt++) {
        try {
          await refetch();
          const { data: { user: currentUser } } = await supabase.auth.getUser();
          if (currentUser) {
            const { data } = await supabase
              .from("user_flags")
              .select("is_premium")
              .eq("user_id", currentUser.id)
              .single();
            if (data?.is_premium) {
              setIsConfirming(false);
              toast({
                title: "Welcome to Premium! 🎉",
                description: "Your subscription is now active. Enjoy all premium features!",
              });
              analytics.checkoutSuccess();
              return;
            }
          }
        } catch (err) {
          console.warn("Premium confirmation check failed:", err);
        }
        if (attempt < MAX_CONFIRM_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, CONFIRM_RETRY_DELAY));
        }
      }
    } finally {
      // Always exit confirming state
      setIsConfirming(false);
    }

    setConfirmFailed(true);
    await refetch().catch(() => {});
  }, [refetch, toast]);

  // Check for success/canceled query params
  useEffect(() => {
    const success = searchParams.get("success");
    const canceled = searchParams.get("canceled");

    if (success === "1") {
      confirmPremiumStatus();
      window.history.replaceState({}, "", "/premium");
    } else if (canceled === "1") {
      toast({
        variant: "destructive",
        title: "Checkout canceled",
        description: "Your subscription was not completed.",
      });
      analytics.checkoutCancel();
      window.history.replaceState({}, "", "/premium");
    }
  }, [searchParams, toast, confirmPremiumStatus]);

  // Check auth status
  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      setIsAuthLoading(false);
    }
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleCheckout = async (plan: "monthly" | "yearly" | "playoff") => {
    if (!user) {
      navigate("/auth");
      return;
    }

    // Track click event
    if (plan === "monthly") {
      analytics.clickSubscribeMonthly();
    } else {
      analytics.clickSubscribeYearly();
    }

    setIsCheckoutLoading(plan);

    try {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", {
        body: { priceId: PRICE_IDS[plan], allowPromoCodes: plan === "playoff" },
      });

      if (error) throw error;

      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error) {
      console.error("Checkout error:", error);
      toast({
        variant: "destructive",
        title: "Checkout failed",
        description: error instanceof Error ? error.message : "Please try again later.",
      });
    } finally {
      setIsCheckoutLoading(null);
    }
  };

  const handleManageBilling = async () => {
    setIsPortalLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("create-portal-session");

      if (error) throw error;

      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No portal URL returned");
      }
    } catch (error) {
      console.error("Portal error:", error);
      toast({
        variant: "destructive",
        title: "Could not open billing portal",
        description: error instanceof Error ? error.message : "Please try again later.",
      });
    } finally {
      setIsPortalLoading(false);
    }
  };

  const isLoading = isAuthLoading || isPremiumLoading;

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
        {isLoading || isConfirming ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            {isConfirming && (
              <div className="text-center space-y-2">
                <p className="text-sm font-medium text-foreground">Confirming your Premium access…</p>
                <p className="text-xs text-muted-foreground">This usually takes just a few seconds.</p>
              </div>
            )}
          </div>
        ) : confirmFailed && !isPremium ? (
          <Card className="bg-card border-border">
            <CardContent className="p-6 space-y-4">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 mx-auto rounded-full bg-primary/20 flex items-center justify-center">
                  <Check className="h-8 w-8 text-primary" />
                </div>
                <h2 className="text-xl font-bold text-foreground">
                  Payment received!
                </h2>
                <p className="text-sm text-muted-foreground">
                  Your payment went through, but your Premium access may take a few more seconds to activate. Please refresh in a moment.
                </p>
              </div>
              <Button onClick={() => window.location.reload()} className="w-full" size="lg">
                Refresh Now
              </Button>
            </CardContent>
          </Card>
        ) : isPremium ? (
          // Premium User View
          <Card className="bg-card border-border">
            <CardContent className="p-6 space-y-6">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 mx-auto rounded-full bg-yellow-500/20 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-yellow-500" />
                </div>
                <h2 className="text-xl font-bold text-foreground">
                  You're a Premium Member!
                </h2>
                <p className="text-muted-foreground">
                  Enjoy unlimited access to all premium features.
                </p>
              </div>

              <div className="space-y-3">
                {PREMIUM_FEATURES.map((feature, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                      <Check className="h-3 w-3 text-green-500" />
                    </div>
                    <span className="text-sm text-foreground">{feature}</span>
                  </div>
                ))}
              </div>

              <Button
                onClick={handleManageBilling}
                variant="outline"
                className="w-full"
                size="lg"
                disabled={isPortalLoading}
              >
                {isPortalLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Opening...
                  </>
                ) : (
                  <>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Manage Billing
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ) : !user ? (
          // Logged Out View
          <Card className="bg-card border-border">
            <CardContent className="p-6 space-y-6">
              <div className="text-center space-y-2">
                <h2 className="text-xl font-bold text-foreground">
                  BetStreaks Premium
                </h2>
                <p className="text-muted-foreground">
                  Log in to upgrade your account
                </p>
              </div>

              <div className="space-y-3">
                {PREMIUM_FEATURES.map((feature, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
                      <Check className="h-3 w-3 text-primary" />
                    </div>
                    <span className="text-sm text-foreground">{feature}</span>
                  </div>
                ))}
              </div>

              <Button asChild className="w-full" size="lg">
                <Link to="/auth">Log in to Upgrade</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          // Non-Premium User View - Subscription Options
          <div className="space-y-6">
            {/* Playoff Pass — NBA-Playoffs only */}
            {sport === "NBA" && (
            <Card className="border-2 border-primary relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-primary" />
              <CardContent className="p-6 space-y-5">
                <div className="flex justify-center">
                  <Badge className="bg-primary text-primary-foreground text-xs px-3 py-1">
                    Most Popular
                  </Badge>
                </div>
                <div className="text-center space-y-2">
                  <h2 className="text-xl font-bold text-foreground">
                    🔥 NBA Playoffs Pass
                  </h2>
                  <p className="text-3xl font-extrabold text-foreground">$25</p>
                  <p className="text-sm text-muted-foreground">
                    Full access through the Finals
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Renews monthly after playoffs • Cancel anytime
                  </p>
                </div>

                <div className="space-y-2.5">
                  {[
                    "Unlimited AI-generated slips",
                    "High hit-rate player trends",
                    "Playoff matchup analysis",
                    "Live streak alerts",
                    "Advanced stats & splits",
                  ].map((feature, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
                        <Check className="h-3 w-3 text-primary" />
                      </div>
                      <span className="text-sm text-foreground">{feature}</span>
                    </div>
                  ))}
                </div>

                <p className="text-xs font-medium text-center text-primary">
                  Limited-time playoff pricing — ends after Finals
                </p>

                <Button
                  onClick={() => handleCheckout("playoff")}
                  className="w-full"
                  size="lg"
                  disabled={isCheckoutLoading !== null}
                >
                  {isCheckoutLoading === "playoff" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Unlock Playoff Access"
                  )}
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  Takes 10 seconds • Instant access
                </p>
                <p className="text-xs text-center text-muted-foreground">
                  Promo codes accepted at checkout
                </p>
              </CardContent>
            </Card>
            )}

            {/* Standard Plans */}
            <Card className="bg-card border-border">
              <CardContent className="p-6 space-y-6">
                <div className="text-center space-y-2">
                  <h2 className="text-xl font-bold text-foreground">
                    BetStreaks Premium
                  </h2>
                  <p className="text-muted-foreground">
                    Unlock all features and catch streaks early
                  </p>
                </div>

                <div className="space-y-3">
                  {PREMIUM_FEATURES.map((feature, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
                        <Check className="h-3 w-3 text-primary" />
                      </div>
                      <span className="text-sm text-foreground">{feature}</span>
                    </div>
                  ))}
                </div>

                {/* Pricing Cards */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  {/* Monthly */}
                  <div className="border border-border rounded-lg p-4 space-y-3">
                    <div className="text-center">
                      <p className="text-sm font-medium text-muted-foreground">Monthly</p>
                      <p className="text-2xl font-bold text-foreground">$10</p>
                      <p className="text-xs text-muted-foreground">per month</p>
                    </div>
                    <Button
                      onClick={() => handleCheckout("monthly")}
                      className="w-full"
                      size="sm"
                      disabled={isCheckoutLoading !== null}
                    >
                      {isCheckoutLoading === "monthly" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Subscribe"
                      )}
                    </Button>
                  </div>

                  {/* Yearly */}
                  <div className="border-2 border-primary rounded-lg p-4 space-y-3 relative">
                    <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs">
                      Best Value
                    </Badge>
                    <div className="text-center">
                      <p className="text-sm font-medium text-muted-foreground">Yearly</p>
                      <p className="text-2xl font-bold text-foreground">$60</p>
                      <p className="text-xs text-muted-foreground">per year</p>
                    </div>
                    <Button
                      onClick={() => handleCheckout("yearly")}
                      className="w-full"
                      size="sm"
                      disabled={isCheckoutLoading !== null}
                    >
                      {isCheckoutLoading === "yearly" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Subscribe"
                      )}
                    </Button>
                  </div>
                </div>

                <div className="text-center space-y-1">
                  <p className="text-xs font-medium text-primary">
                    Early access pricing — may increase soon
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Cancel anytime. Secure payment via Stripe.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
