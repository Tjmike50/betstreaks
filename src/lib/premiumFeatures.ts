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
// Reflects the actual current BetStreaks product surfaces.
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

export const PREMIUM_PRICING = {
  monthly: {
    amount: 10,
    display: "$10",
    period: "month",
  },
  yearly: {
    amount: 60,
    display: "$60",
    period: "year",
  },
} as const;
