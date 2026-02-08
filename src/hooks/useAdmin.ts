import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

interface AdminStatus {
  isAdmin: boolean;
  isLoading: boolean;
  userId: string | null;
}

export function useAdmin(): AdminStatus {
  const [userId, setUserId] = useState<string | null>(null);

  // Get the current user
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
    };
    
    getUser();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-status", userId],
    queryFn: async (): Promise<boolean> => {
      if (!userId) return false;

      const { data: flags, error } = await supabase
        .from("user_flags")
        .select("is_admin")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("Error checking admin status:", error);
        return false;
      }

      return flags?.is_admin ?? false;
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 30 * 60 * 1000,
  });

  return {
    isAdmin: data ?? false,
    isLoading: !userId ? false : isLoading,
    userId,
  };
}
