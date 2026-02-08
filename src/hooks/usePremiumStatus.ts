import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function usePremiumStatus() {
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function checkPremiumStatus() {
      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          if (isMounted) {
            setIsPremium(false);
            setIsLoading(false);
            setUserId(null);
          }
          return;
        }

        if (isMounted) {
          setUserId(user.id);
        }

        // Query user_flags for premium status
        const { data, error } = await supabase
          .from("user_flags")
          .select("is_premium")
          .eq("user_id", user.id)
          .single();

        if (isMounted) {
          if (error) {
            // No record found means not premium
            console.log("No user_flags record found, defaulting to non-premium");
            setIsPremium(false);
          } else {
            setIsPremium(data?.is_premium ?? false);
          }
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Error checking premium status:", error);
        if (isMounted) {
          setIsPremium(false);
          setIsLoading(false);
        }
      }
    }

    checkPremiumStatus();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkPremiumStatus();
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Function to manually refetch premium status
  const refetch = async () => {
    setIsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      setIsPremium(false);
      setIsLoading(false);
      return;
    }

    const { data } = await supabase
      .from("user_flags")
      .select("is_premium")
      .eq("user_id", user.id)
      .single();

    setIsPremium(data?.is_premium ?? false);
    setIsLoading(false);
  };

  return {
    isPremium,
    isLoading,
    userId,
    refetch,
  };
}
