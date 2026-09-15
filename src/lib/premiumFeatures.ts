import {
  Wand2,
  Brain,
  Sparkles,
  BookOpen,
  Bookmark,
  Layers,
  Zap,
  type LucideIcon,
} from "lucide-react";

// Single source of truth for the Premium feature list.
// Used by PremiumPage, PremiumLockModal, and PremiumLockedScreen.
export const PREMIUM_FEATURES = [
  "AI Slip Builder — unlimited slips per day",
  "Bet Analyzer — score any slip you're considering",
  "Daily AI Pick across NBA, WNBA & MLB",
  "Full Cheatsheets: Value, Best Bets, Streaks, Matchups",
  "Research tools: player splits, recent form, vs-opponent",
  "Save slips & track your history",
  "Multi-sport coverage in one app",
] as const;

export interface PremiumFeatureWithIcon {
  icon: LucideIcon;
  text: string;
}

export const PREMIUM_FEATURES_WITH_ICONS: PremiumFeatureWithIcon[] = [
  { icon: Wand2, text: "Unlimited AI Slip Builder" },
  { icon: Brain, text: "Bet Analyzer for any slip" },
  { icon: Sparkles, text: "Daily AI Pick (NBA · WNBA · MLB)" },
  { icon: BookOpen, text: "Full Cheatsheets & Research tools" },
  { icon: Bookmark, text: "Save slips & track results" },
  { icon: Layers, text: "Multi-sport coverage" },
  { icon: Zap, text: "Early-access to new features" },
];

// Plan keys are the contract between frontend and the create-checkout-session
// edge function. The function maps each key to its Stripe price env var.
export type PlanKey = "monthly" | "yearly" | "lifetime" | "all_apps_lifetime" | "weekly_pass";

export const PREMIUM_PRICING = {
  monthly: {
    key: "monthly" as const,
    amount: 17.5,
    display: "$17.50",
    period: "month",
    mode: "subscription" as const,
  },
  yearly: {
    key: "yearly" as const,
    amount: 180,
    display: "$180",
    period: "year",
    mode: "subscription" as const,
  },
  lifetime: {
    key: "lifetime" as const,
    amount: 480,
    display: "$480",
    period: "one-time",
    mode: "payment" as const,
  },
  all_apps_lifetime: {
    key: "all_apps_lifetime" as const,
    amount: 3000,
    display: "$3,000",
    period: "one-time",
    mode: "payment" as const,
  },
} as const;

export const LIFETIME_DISCLAIMER =
  "Lifetime access means access for the lifetime of the supported product/platform. Access is non-transferable and subject to our terms, acceptable use rules, and platform availability.";

export const BETTING_DISCLAIMER =
  "BetStreaks is for informational and entertainment purposes only. No picks, slips, streaks, or AI outputs are guaranteed. Past performance does not guarantee future results.";
