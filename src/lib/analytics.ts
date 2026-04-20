import { supabase } from "@/integrations/supabase/client";

// Simple analytics tracking for conversion funnel
// Events are stored in a Supabase table for privacy-friendly tracking
// AND forwarded to an external Supabase project via the forward-event edge function

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

async function forwardToExternal(
  event: AnalyticsEvent,
  userId: string | null,
  metadata: Record<string, unknown> | null
): Promise<void> {
  try {
    await supabase.functions.invoke("forward-event", {
      body: { event_name: event, user_id: userId, metadata },
    });
  } catch {
    // Silently fail — external forwarding should never impact UX
  }
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

    const meta = options.metadata ?? null;

    // Insert into local analytics table
    const { error } = await supabase
      .from("analytics_events")
      .insert([{
        event_name: event,
        user_id: userId ?? undefined,
        metadata: meta ?? undefined,
      }]);

    if (error) {
      console.warn("Analytics tracking failed:", error.message);
    }

    // Also forward to external project (fire-and-forget)
    forwardToExternal(event, userId ?? null, meta as Record<string, unknown> | null);
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