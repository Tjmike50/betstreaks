import { useNavigate } from "react-router-dom";
import { Star, ChevronRight, Crown, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Footer } from "@/components/Footer";
import { useFavorites } from "@/hooks/useFavorites";
import { useAuth } from "@/contexts/AuthContext";
import { PremiumBadge } from "@/components/PremiumBadge";

const FavoritesPage = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: isAuthLoading, email } = useAuth();
  const { favorites, isLoading } = useFavorites();

  // Show loading state while auth initializes
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center pb-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20">
      {/* Header */}
      <header className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Star className="h-6 w-6 text-yellow-500 fill-yellow-500" />
          <h1 className="text-2xl font-bold text-foreground">Favorites</h1>
          <PremiumBadge />
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Your favorite players
        </p>
        {isAuthenticated && email && (
          <p className="text-xs text-muted-foreground mt-1">
            Logged in as {email}
          </p>
        )}
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-4">
        {!isAuthenticated ? (
          <div className="text-center py-12 space-y-4">
            <Crown className="h-12 w-12 text-yellow-500 mx-auto" />
            <div>
              <p className="text-muted-foreground mb-4">
                Log in to save your favorite players
              </p>
              <Button onClick={() => navigate("/auth")}>
                Log in
              </Button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : favorites.length === 0 ? (
          <div className="text-center py-12">
            <Star className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
            <p className="text-muted-foreground">No favorite players yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Tap the ⭐ on any player to add them here
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg overflow-hidden border border-border">
            {favorites.map((player) => (
              <Card
                key={player.id}
                className="rounded-none border-0 cursor-pointer transition-colors hover:bg-accent/50 active:bg-accent/70"
                onClick={() => navigate(`/player/${player.player_id}`)}
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                    <span className="font-medium">{player.player_name || `Player #${player.player_id}`}</span>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default FavoritesPage;
