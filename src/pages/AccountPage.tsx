import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Footer } from "@/components/Footer";
import { User, LogIn, Star, RefreshCw, Infinity, LogOut, Loader2, Crown, FileText, Shield, AlertTriangle, MessageSquare, Check, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export default function AccountPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const { isPremium, isLoading: isPremiumLoading } = usePremiumStatus();

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_, session) => {
        setUser(session?.user ?? null);
        setIsLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    const { error } = await supabase.auth.signOut();
    setIsLoggingOut(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to log out. Please try again.",
      });
      return;
    }

    toast({
      title: "Logged out",
      description: "You've been logged out successfully.",
    });
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderPremiumCard = () => {
    if (!user) {
      // Logged out - show upgrade teaser
      return (
        <Card 
          className="bg-gradient-to-r from-yellow-500/10 to-yellow-500/5 border-yellow-500/20 cursor-pointer hover:bg-yellow-500/15 transition-colors"
          onClick={() => navigate("/premium")}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-yellow-500/20">
                <Crown className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Go Premium</h3>
                <p className="text-xs text-muted-foreground">$10/mo or $60/yr</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">
              Learn more
            </Button>
          </CardContent>
        </Card>
      );
    }

    if (isPremiumLoading) {
      return (
        <Card className="bg-gradient-to-r from-yellow-500/10 to-yellow-500/5 border-yellow-500/20">
          <CardContent className="p-4 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      );
    }

    if (isPremium) {
      // Premium user - show status and manage button
      return (
        <Card className="bg-gradient-to-r from-green-500/10 to-green-500/5 border-green-500/20">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-500/20">
                <Check className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">You are Premium</h3>
                <p className="text-xs text-muted-foreground">All features unlocked</p>
              </div>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="border-green-500/30 text-green-500 hover:bg-green-500/10"
              onClick={handleManageBilling}
              disabled={isPortalLoading}
            >
              {isPortalLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Manage
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      );
    }

    // Logged in but not premium - show upgrade CTA
    return (
      <Card 
        className="bg-gradient-to-r from-yellow-500/10 to-yellow-500/5 border-yellow-500/20 cursor-pointer hover:bg-yellow-500/15 transition-colors"
        onClick={() => navigate("/premium")}
      >
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-yellow-500/20">
              <Crown className="h-5 w-5 text-yellow-500" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Go Premium</h3>
              <p className="text-xs text-muted-foreground">$10/mo or $60/yr</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">
            Upgrade
          </Button>
        </CardContent>
      </Card>
    );
  };

  // Logged in state
  if (user) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="px-4 py-4 border-b border-border">
          <h1 className="text-2xl font-bold text-foreground">
            👤 Account
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your account
          </p>
        </header>

        <main className="flex-1 px-4 py-6 pb-20">
          <Card className="bg-card border-border">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/20 mx-auto">
                <User className="h-8 w-8 text-primary" />
              </div>
              
              <div className="text-center space-y-2">
                <h2 className="text-lg font-semibold text-foreground">
                  Logged in
                </h2>
                <p className="text-sm text-muted-foreground break-all">
                  {user.email}
                </p>
                
                {/* Tier Badge */}
                {isPremiumLoading ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking...
                  </span>
                ) : isPremium ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/20 text-green-500 text-xs font-medium">
                    <Check className="h-3 w-3" />
                    Premium
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium">
                    Free Plan
                  </span>
                )}
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <RefreshCw className="h-4 w-4 text-primary shrink-0" />
                  <span>Watchlist synced across devices</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <Infinity className="h-4 w-4 text-primary shrink-0" />
                  <span>Unlimited saved picks</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <Star className="h-4 w-4 text-primary shrink-0" />
                  <span>Personalized recommendations</span>
                </div>
              </div>

              {/* Premium Card */}
              {renderPremiumCard()}

              {/* Feedback Link */}
              <div 
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => navigate("/feedback")}
              >
                <MessageSquare className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">Report an issue / Suggest a feature</p>
                  <p className="text-xs text-muted-foreground">Help us improve BetStreaks</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 mt-4">
                <Button 
                  variant="outline"
                  className="w-full" 
                  size="lg"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                >
                  {isLoggingOut ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Logging out...
                    </>
                  ) : (
                    <>
                      <LogOut className="h-4 w-4 mr-2" />
                      Log out
                    </>
                  )}
                </Button>
              </div>

              <div className="flex items-center justify-center gap-4 pt-4 flex-wrap">
                <Link 
                  to="/terms" 
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <FileText className="h-4 w-4" />
                  Terms
                </Link>
                <Link 
                  to="/privacy" 
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Shield className="h-4 w-4" />
                  Privacy
                </Link>
                <Link 
                  to="/responsible-gambling" 
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <AlertTriangle className="h-4 w-4" />
                  Responsible Gambling
                </Link>
              </div>
            </CardContent>
          </Card>
        </main>

        <Footer />
      </div>
    );
  }

  // Logged out state
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-4 py-4 border-b border-border">
        <h1 className="text-2xl font-bold text-foreground">
          👤 Account
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account
        </p>
      </header>

      <main className="flex-1 px-4 py-6 pb-20">
        <Card className="bg-card border-border">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted mx-auto">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
            
            <div className="text-center space-y-2">
              <h2 className="text-lg font-semibold text-foreground">
                Not logged in
              </h2>
              <p className="text-sm text-muted-foreground">
                Log in to unlock all features
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 text-primary shrink-0" />
                <span>Sync watchlist across devices</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Infinity className="h-4 w-4 text-primary shrink-0" />
                <span>Unlimited saved picks</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Star className="h-4 w-4 text-primary shrink-0" />
                <span>Personalized recommendations</span>
              </div>
            </div>

            {/* Premium Card */}
            {renderPremiumCard()}

            {/* Feedback Link */}
            <div 
              className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
              onClick={() => navigate("/feedback")}
            >
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Report an issue / Suggest a feature</p>
                <p className="text-xs text-muted-foreground">Help us improve BetStreaks</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-4">
              <Button 
                className="w-full" 
                size="lg"
                onClick={() => navigate("/auth")}
              >
                <LogIn className="h-4 w-4 mr-2" />
                Log in
              </Button>
            </div>

            <div className="flex items-center justify-center gap-4 pt-4 flex-wrap">
              <Link 
                to="/terms" 
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <FileText className="h-4 w-4" />
                Terms
              </Link>
              <Link 
                to="/privacy" 
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Shield className="h-4 w-4" />
                Privacy
              </Link>
              <Link 
                to="/responsible-gambling" 
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <AlertTriangle className="h-4 w-4" />
                Responsible Gambling
              </Link>
            </div>
          </CardContent>
        </Card>
      </main>

      <Footer />
    </div>
  );
}
