// Premium status hook - currently returns false for all users
// as Premium is "Coming Soon". Update this when premium is implemented.

export function usePremiumStatus() {
  // TODO: Implement actual premium status check when premium launches
  // This could check a subscription status in Supabase, Stripe, etc.
  
  return {
    isPremium: false,
    isLoading: false,
  };
}
