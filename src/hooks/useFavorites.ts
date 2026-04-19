import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useSport } from "@/contexts/SportContext";
import { analytics } from "@/lib/analytics";
import type { SportKey } from "@/lib/sports/registry";

interface FavoritePlayer {
  id: string;
  player_id: number;
  player_name: string | null;
  user_id: string;
  sport: string;
  created_at: string;
}

export function useFavorites(sportOverride?: SportKey) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const { sport: activeSport } = useSport();
  const sport = sportOverride ?? activeSport;
  const userId = user?.id ?? null;

  const { data: favorites = [], isLoading } = useQuery({
    queryKey: ["favorites", userId, sport],
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await supabase
        .from("favorite_players")
        .select("*")
        .eq("user_id", userId)
        .eq("sport", sport)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as FavoritePlayer[];
    },
    enabled: !!userId,
  });

  const addFavorite = useMutation({
    mutationFn: async ({ playerId, playerName }: { playerId: number; playerName: string }) => {
      if (!userId) throw new Error("Must be logged in");

      const { error } = await supabase
        .from("favorite_players")
        .insert({
          player_id: playerId,
          player_name: playerName,
          user_id: userId,
          sport,
        });

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["favorites"] });
      toast({ title: "Player added to favorites ⭐" });
      analytics.addFavorite(variables.playerId, variables.playerName);
    },
    onError: () => {
      toast({ title: "Failed to add favorite", variant: "destructive" });
    },
  });

  const removeFavorite = useMutation({
    mutationFn: async (playerId: number) => {
      if (!userId) throw new Error("Must be logged in");

      const { error } = await supabase
        .from("favorite_players")
        .delete()
        .eq("user_id", userId)
        .eq("sport", sport)
        .eq("player_id", playerId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorites"] });
      toast({ title: "Player removed from favorites" });
    },
    onError: () => {
      toast({ title: "Failed to remove favorite", variant: "destructive" });
    },
  });

  const isFavorite = (playerId: number) => {
    return favorites.some((f) => f.player_id === playerId);
  };

  const toggleFavorite = (playerId: number, playerName: string) => {
    if (isFavorite(playerId)) {
      removeFavorite.mutate(playerId);
    } else {
      addFavorite.mutate({ playerId, playerName });
    }
  };

  return {
    favorites,
    isLoading,
    isFavorite,
    toggleFavorite,
    isAuthenticated,
    sport,
  };
}
