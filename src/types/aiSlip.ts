export interface LegDataContext {
  season_avg?: number | null;
  last5_avg?: number | null;
  last10_hit_rate?: string | null;
  line_hit_rate?: string | null;
  vs_opponent?: string | null;
  home_away_split?: string | null;
  confidence_score?: number | null;
  value_score?: number | null;
  volatility_label?: "low" | "medium" | "high" | null;
  sample_size?: number | null;
  tags?: string[];
  rest_note?: string | null;
  opp_defense_note?: string | null;
  vs_opponent_sample?: number | null;
  home_away_sample?: number | null;
  teammate_note?: string | null;
  minutes_trend?: "up" | "down" | "stable" | null;
  role_label?: "starter" | "bench" | null;
  availability_note?: string | null;
  lineup_confidence?: "high" | "medium" | "low" | null;
  market_note?: string | null;
  odds_source?: string | null;
  implied_probability?: number | null;
  odds_validated?: boolean | null;
  best_over_odds?: string | null;
  best_under_odds?: string | null;
  market_threshold?: number | null;
  // Market normalization fields
  market_confidence?: number | null;
  consensus_line?: number | null;
  books_count?: number | null;
  is_main_line?: boolean | null;
  edge?: number | null;
  // Game-level matchup info
  home_team?: string | null;
  away_team?: string | null;
  opponent?: string | null;
  is_home?: boolean | null;
  spread?: number | null;
  total_line?: number | null;
  pick_side?: string | null;
}

export type LegBetType = "player_prop" | "moneyline" | "spread" | "total";

export interface AISlipLeg {
  id?: string;
  slip_id?: string;
  player_name: string;
  team_abbr: string | null;
  stat_type: string;
  line: string;
  pick: string;
  odds: string | null;
  reasoning: string | null;
  leg_order: number;
  data_context?: LegDataContext | null;
  bet_type?: LegBetType;
}

export interface AISlip {
  id: string;
  user_id: string | null;
  prompt: string;
  slip_name: string;
  risk_label: "safe" | "balanced" | "aggressive";
  estimated_odds: string | null;
  reasoning: string | null;
  created_at: string;
  legs: AISlipLeg[];
}

export interface BetAnalysis {
  overall_grade: string;
  overall_reasoning: string;
  strongest_leg: { leg_index: number; reasoning: string };
  weakest_leg: { leg_index: number; reasoning: string };
  correlation_warnings: string[];
  risk_label: "safe" | "balanced" | "aggressive";
  safer_rebuild: {
    slip_name: string;
    estimated_odds: string;
    reasoning: string;
    legs: AISlipLeg[];
  };
  aggressive_rebuild: {
    slip_name: string;
    estimated_odds: string;
    reasoning: string;
    legs: AISlipLeg[];
  };
}

export interface AnalyzerLegInput {
  player_name: string;
  stat_type: string;
  line: string;
  pick: string;
  odds?: string;
}
