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
}

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
