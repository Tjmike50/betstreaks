import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function usePremiumStatus() {
  const [access, setAccess] = useState({ isPremium: false, basePremium: false, weeklyExpiresAt: null as string | null, userId: null as string | null });
  const [isLoading, setIsLoading] = useState(true);
  const sequence = useRef(0);
  const refetch = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const result = user ? await supabase.rpc("get_premium_access").single() : null;
      if (request !== sequence.current) return;
      const data = result?.error ? null : result?.data;
      setAccess({ isPremium: data?.is_premium ?? false, basePremium: data?.base_premium ?? false, weeklyExpiresAt: data?.weekly_expires_at ?? null, userId: user?.id ?? null });
    } catch {
      if (request === sequence.current) setAccess({ isPremium: false, basePremium: false, weeklyExpiresAt: null, userId: null });
    } finally {
      if (request === sequence.current) setIsLoading(false);
    }
  }, []);
  useEffect(() => {
    void refetch();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { queueMicrotask(() => void refetch()); });
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => { sequence.current++; subscription.unsubscribe(); window.removeEventListener("focus", onFocus); };
  }, [refetch]);
  useEffect(() => {
    if (!access.weeklyExpiresAt || access.basePremium) return;
    const remaining = Date.parse(access.weeklyExpiresAt) - Date.now();
    if (remaining <= 0) return;
    const timeout = window.setTimeout(() => {
      setAccess(current => ({ ...current, isPremium: current.basePremium || Date.parse(current.weeklyExpiresAt ?? "") > Date.now() }));
      void refetch();
    }, Math.min(remaining + 100, 2147483647));
    return () => window.clearTimeout(timeout);
  }, [access, refetch]);
  return { ...access, isLoading, refetch };
}
