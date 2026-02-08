import { Zap, BarChart3, Trophy, Heart, TrendingUp, Users, Target, type LucideIcon } from "lucide-react";

export const PREMIUM_FEATURES = [
  "Player combos (PTS+AST, PTS+REB, PRA, etc.)",
  "Last 10 / 15 / 20 game splits",
  "Real-time streak alerts",
  "Best plays of the day (AI ranked)",
  "Save favorite players",
  "Double-Double & Triple-Double tracking",
  "Historical matchup trends",
] as const;

export interface PremiumFeatureWithIcon {
  icon: LucideIcon;
  text: string;
}

export const PREMIUM_FEATURES_WITH_ICONS: PremiumFeatureWithIcon[] = [
  { icon: Users, text: "Player combos (PTS+AST, PTS+REB, PRA, etc.)" },
  { icon: BarChart3, text: "Last 10 / 15 / 20 game splits" },
  { icon: Zap, text: "Real-time streak alerts" },
  { icon: Trophy, text: "Best plays of the day (AI ranked)" },
  { icon: Heart, text: "Save favorite players" },
  { icon: Target, text: "Double-Double & Triple-Double tracking" },
  { icon: TrendingUp, text: "Historical matchup trends" },
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
