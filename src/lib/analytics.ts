import { supabase } from "@/integrations/supabase/client";

// Simple analytics tracking for conversion funnel
// Events are stored in a Supabase table for privacy-friendly tracking

export type AnalyticsEvent = 
  | "view_premium_page"
  | "click_subscribe_monthly"
  | "click_subscribe_yearly"
  | "checkout_success"
  | "checkout_cancel"
  | "add_favorite"
  | "share_streak";

interface TrackEventOptions {
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function trackEvent(
  event: AnalyticsEvent, 
  options: TrackEventOptions = {}
): Promise<void> {
  try {
    // Get current user if not provided
    let userId = options.userId;
    if (userId === undefined) {
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    }

    // Insert event into analytics table
    // Use type assertion since table was just created and types may not be synced
    const { error } = await (supabase as ReturnType<typeof supabase.from>)
      .from("analytics_events")
      .insert({
        event_name: event,
        user_id: userId,
        metadata: options.metadata ?? null,
      });

    if (error) {
      // Log but don't throw - analytics should never break the app
      console.warn("Analytics tracking failed:", error.message);
    }
  } catch (err) {
    // Silently fail - analytics should never impact UX
    console.warn("Analytics tracking error:", err);
  }
}

// Convenience methods for common events
export const analytics = {
  viewPremiumPage: () => trackEvent("view_premium_page"),
  clickSubscribeMonthly: () => trackEvent("click_subscribe_monthly"),
  clickSubscribeYearly: () => trackEvent("click_subscribe_yearly"),
  checkoutSuccess: () => trackEvent("checkout_success"),
  checkoutCancel: () => trackEvent("checkout_cancel"),
  addFavorite: (playerId: number, playerName: string) => 
    trackEvent("add_favorite", { metadata: { playerId, playerName } }),
  shareStreak: (streakId: string, playerName: string) =>
    trackEvent("share_streak", { metadata: { streakId, playerName } }),
};