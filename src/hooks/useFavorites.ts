import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";

interface FavoritePlayer {
  id: string;
  player_id: number;
  player_name: string | null;
  user_id: string;
  created_at: string;
}

export function useFavorites() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
    };
    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const { data: favorites = [], isLoading } = useQuery({
    queryKey: ["favorites", userId],
    queryFn: async () => {
      if (!userId) return [];
      
      const { data, error } = await supabase
        .from("favorite_players")
        .select("*")
        .eq("user_id", userId)
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
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorites"] });
      toast({ title: "Player added to favorites ⭐" });
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
    isAuthenticated: !!userId,
  };
}
