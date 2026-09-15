import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Footer } from "@/components/Footer";
import { ArrowLeft, Crown, Check, Loader2, ExternalLink, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { WeeklyPassCard } from "@/components/WeeklyPassCard";
import { Badge } from "@/components/ui/badge";
import {
  PREMIUM_FEATURES,
  PREMIUM_PRICING,
  LIFETIME_DISCLAIMER,
  BETTING_DISCLAIMER,
  type PlanKey,
} from "@/lib/premiumFeatures";
import { analytics } from "@/lib/analytics";
import { useBillingStatus } from "@/hooks/useBillingStatus";

const MAX_CONFIRM_RETRIES = 5;
const CONFIRM_RETRY_DELAY = 2000;

interface PlanCard {
  key: PlanKey;
  title: string;
  price: string;
  period: string;
  description: string;
  badge?: string;
  buttonLabel: string;
  highlight?: boolean;
}

const PLAN_CARDS: PlanCard[] = [
  {
    key: "monthly",
    title: "Premium Monthly",
    price: PREMIUM_PRICING.monthly.display,
    period: "/mo",
    description: "Best for trying BetStreaks and getting daily access.",
    buttonLabel: "Start Monthly",
  },
  {
    key: "yearly",
    title: "Premium Yearly",
    price: PREMIUM_PRICING.yearly.display,
    period: "/year",
    description: "Best value for serious users. Save $30 compared to monthly.",
    badge: "Best Value",
    buttonLabel: "Go Yearly",
    highlight: true,
  },
  {
    key: "lifetime",
    title: "BetStreaks Lifetime",
    price: PREMIUM_PRICING.lifetime.display,
    period: "one-time",
    description: "Pay once and keep BetStreaks Premium access.",
    badge: "Lifetime Deal",
    buttonLabel: "Get Lifetime",
  },
  {
    key: "all_apps_lifetime",
    title: "All Apps Lifetime Pass",
    price: PREMIUM_PRICING.all_apps_lifetime.display,
    period: "one-time",
    description:
      "Lifetime access to BetStreaks plus all included Carter Apps products released under the all-apps pass.",
    badge: "Founder Pass",
    buttonLabel: "Get All Apps Lifetime",
  },
];

export default function PremiumPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const { isPremium, basePremium, weeklyExpiresAt, isLoading: isPremiumLoading, refetch } = usePremiumStatus();
  const billing = useBillingStatus(isPremium, isPremiumLoading, weeklyExpiresAt, basePremium);

  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState<PlanKey | null>(null);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmFailed, setConfirmFailed] = useState(false);
  const [weeks, setWeeks] = useState(() => sessionStorage.getItem("betstreaks-prepaid-weeks") || "1");

  useEffect(() => {
    analytics.viewPremiumPage();
  }, []);

  const confirmPremiumStatus = useCallback(async (weeklySession?: string | null) => {
    setIsConfirming(true);
    setConfirmFailed(false);

    try {
      for (let attempt = 0; attempt < MAX_CONFIRM_RETRIES; attempt++) {
        try {
          await refetch();
          const { data: { user: currentUser } } = await supabase.auth.getUser();
          if (currentUser) {
            const { data } = await supabase
              .rpc("get_premium_access")
              .single();
            const purchase = weeklySession ? await supabase.from("premium_weekly_passes").select("expires_at").eq("checkout_session_id", weeklySession).maybeSingle() : null;
            if (data?.is_premium && (!weeklySession || purchase?.data)) {
              setIsConfirming(false);
              toast({
                title: "Welcome to Premium! 🎉",
                description: "Your access is now active. Enjoy all premium features!",
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
      setIsConfirming(false);
    }

    setConfirmFailed(true);
    await refetch().catch(() => {});
  }, [refetch, toast]);

  useEffect(() => {
    const success = searchParams.get("success");
    const canceled = searchParams.get("canceled");

    if (success === "1") {
      confirmPremiumStatus(searchParams.get("weekly_session"));
      window.history.replaceState({}, "", "/premium");
    } else if (canceled === "1") {
      toast({
        variant: "destructive",
        title: "Checkout canceled",
        description: "Your purchase was not completed.",
      });
      analytics.checkoutCancel();
      window.history.replaceState({}, "", "/premium");
    }
  }, [searchParams, toast, confirmPremiumStatus]);

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

  const handleCheckout = async (plan: PlanKey) => {
    if (plan === "weekly_pass") {
      const count = Number(weeks);
      if (!Number.isInteger(count) || count < 1 || count > 520) return;
      sessionStorage.setItem("betstreaks-prepaid-weeks", weeks);
    }
    if (!user) {
      navigate("/auth?next=premium");
      return;
    }

    if (plan === "monthly") analytics.clickSubscribeMonthly();
    if (plan === "yearly") analytics.clickSubscribeYearly();

    setIsCheckoutLoading(plan);

    try {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", {
        body: { plan, ...(plan === "weekly_pass" ? { weeks: Number(weeks) } : {}) },
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
        return;
      }
      if (data?.error) {
        toast({
          variant: "destructive",
          title: "Billing portal unavailable",
          description: data.error,
        });
        return;
      }
      throw new Error("No portal URL returned");
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
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Crown className="h-6 w-6 text-premium" />
            Premium
          </h1>
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
                <h2 className="text-xl font-bold text-foreground">Still confirming your purchase</h2>
                <p className="text-sm text-muted-foreground">
                  Your Premium access is not confirmed yet. If you completed payment, please refresh in a moment.
                </p>
              </div>
              <Button onClick={() => window.location.reload()} className="w-full" size="lg">
                Refresh Now
              </Button>
            </CardContent>
          </Card>
        ) : isPremium ? (
          <Card className="bg-card border-border">
            <CardContent className="p-6 space-y-6">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 mx-auto rounded-full bg-premium/20 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-premium" />
                </div>
                <h2 className="text-xl font-bold text-foreground">You're a Premium Member!</h2>
                <p className="text-muted-foreground">Enjoy access to all premium features.</p>
              </div>

              <div className="space-y-3">
                {PREMIUM_FEATURES.map((feature, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-success/20 flex items-center justify-center">
                      <Check className="h-3 w-3 text-success" />
                    </div>
                    <span className="text-sm text-foreground">{feature}</span>
                  </div>
                ))}
              </div>

              {billing.state === "active_subscription" ? (
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
              ) : billing.state === "weekly_pass" ? (
                <p className="text-sm text-center">Prepaid access until {new Date(weeklyExpiresAt!).toLocaleString()}. No automatic renewal.</p>
              ) : billing.state === "lifetime" ? (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-center">
                  <p className="text-sm font-medium text-foreground">
                    Lifetime access active.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    No subscription to manage.
                  </p>
                </div>
              ) : billing.state === "premium_no_billing" ? (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-center">
                  <p className="text-sm font-medium text-foreground">
                    Premium access is active.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    There is no subscription to manage.
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </CardContent>
          </Card>
        ) : !user ? (
          <Card className="bg-card border-border">
            <CardContent className="p-6 space-y-6">
              <div className="text-center space-y-2">
                <h2 className="text-xl font-bold text-foreground">BetStreaks Premium</h2>
                <p className="text-muted-foreground">Log in to upgrade your account</p>
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
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-foreground">Choose your plan</h2>
              <p className="text-sm text-muted-foreground">
                Choose a subscription, prepaid weeks, or lifetime access.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PLAN_CARDS.map((card) => {
                const isHighlight = !!card.highlight;
                return (
                  <Card
                    key={card.key}
                    className={
                      isHighlight
                        ? "border-2 border-primary relative overflow-hidden"
                        : "bg-card border-border relative overflow-hidden"
                    }
                  >
                    {card.badge && (
                      <div className="absolute top-3 right-3">
                        <Badge
                          className={
                            isHighlight
                              ? "bg-primary text-primary-foreground"
                              : "bg-premium/20 text-premium border-premium/30"
                          }
                        >
                          {card.badge}
                        </Badge>
                      </div>
                    )}
                    <CardContent className="p-5 space-y-4">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">
                          {card.title}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1 leading-snug">
                          {card.description}
                        </p>
                      </div>

                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-extrabold text-foreground">
                          {card.price}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {card.period}
                        </span>
                      </div>

                      <Button
                        onClick={() => handleCheckout(card.key)}
                        className="w-full"
                        size="lg"
                        disabled={isCheckoutLoading !== null}
                        variant={isHighlight ? "default" : "outline"}
                      >
                        {isCheckoutLoading === card.key ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          card.buttonLabel
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className="bg-muted/30 border-border">
              <CardContent className="p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-foreground mb-1">
                    About lifetime access
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {LIFETIME_DISCLAIMER}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground mb-1">
                    Important
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {BETTING_DISCLAIMER}
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground text-center pt-1">
                  Secure payment via Stripe • Cancel subscriptions anytime
                </p>
              </CardContent>
            </Card>
          </div>
        )}
        {!isLoading && !isConfirming && (!isPremium || billing.state === "weekly_pass") && (
          <div className="mt-6">
            <WeeklyPassCard weeks={weeks} onWeeksChange={setWeeks} onCheckout={() => handleCheckout("weekly_pass")} loading={isCheckoutLoading !== null} loggedIn={!!user} expiresAt={weeklyExpiresAt} />
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
