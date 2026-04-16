export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_daily_pick_legs: {
        Row: {
          daily_pick_id: string
          id: string
          leg_order: number
          line: string
          odds: string | null
          pick: string
          player_name: string
          reasoning: string | null
          stat_type: string
          team_abbr: string | null
        }
        Insert: {
          daily_pick_id: string
          id?: string
          leg_order?: number
          line: string
          odds?: string | null
          pick: string
          player_name: string
          reasoning?: string | null
          stat_type: string
          team_abbr?: string | null
        }
        Update: {
          daily_pick_id?: string
          id?: string
          leg_order?: number
          line?: string
          odds?: string | null
          pick?: string
          player_name?: string
          reasoning?: string | null
          stat_type?: string
          team_abbr?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_daily_pick_legs_daily_pick_id_fkey"
            columns: ["daily_pick_id"]
            isOneToOne: false
            referencedRelation: "ai_daily_picks"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_daily_picks: {
        Row: {
          created_at: string
          estimated_odds: string | null
          id: string
          pick_date: string
          reasoning: string | null
          risk_label: string
          slip_name: string
        }
        Insert: {
          created_at?: string
          estimated_odds?: string | null
          id?: string
          pick_date?: string
          reasoning?: string | null
          risk_label: string
          slip_name: string
        }
        Update: {
          created_at?: string
          estimated_odds?: string | null
          id?: string
          pick_date?: string
          reasoning?: string | null
          risk_label?: string
          slip_name?: string
        }
        Relationships: []
      }
      ai_slip_legs: {
        Row: {
          id: string
          leg_order: number
          line: string
          odds: string | null
          pick: string
          player_name: string
          reasoning: string | null
          slip_id: string
          stat_type: string
          team_abbr: string | null
        }
        Insert: {
          id?: string
          leg_order?: number
          line: string
          odds?: string | null
          pick: string
          player_name: string
          reasoning?: string | null
          slip_id: string
          stat_type: string
          team_abbr?: string | null
        }
        Update: {
          id?: string
          leg_order?: number
          line?: string
          odds?: string | null
          pick?: string
          player_name?: string
          reasoning?: string | null
          slip_id?: string
          stat_type?: string
          team_abbr?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_slip_legs_slip_id_fkey"
            columns: ["slip_id"]
            isOneToOne: false
            referencedRelation: "ai_slips"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_slips: {
        Row: {
          created_at: string
          estimated_odds: string | null
          id: string
          prompt: string
          reasoning: string | null
          risk_label: string
          slip_name: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          estimated_odds?: string | null
          id?: string
          prompt: string
          reasoning?: string | null
          risk_label?: string
          slip_name: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          estimated_odds?: string | null
          id?: string
          prompt?: string
          reasoning?: string | null
          risk_label?: string
          slip_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          id: string
          request_count: number
          usage_date: string
          user_id: string
        }
        Insert: {
          id?: string
          request_count?: number
          usage_date?: string
          user_id: string
        }
        Update: {
          id?: string
          request_count?: number
          usage_date?: string
          user_id?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      app_feedback: {
        Row: {
          app_version: string | null
          category: string
          created_at: string
          email: string | null
          id: string
          message: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          category: string
          created_at?: string
          email?: string | null
          id?: string
          message: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          category?: string
          created_at?: string
          email?: string | null
          id?: string
          message?: string
          user_id?: string | null
        }
        Relationships: []
      }
      eval_daily_snapshots: {
        Row: {
          confidence_buckets: Json | null
          created_at: string
          id: string
          prop_hit_rate: number | null
          prop_hits: number
          prop_total: number
          risk_label_buckets: Json | null
          slip_hit_rate: number | null
          slip_hits: number
          slip_total: number
          snapshot_date: string
          stat_type_buckets: Json | null
          value_buckets: Json | null
        }
        Insert: {
          confidence_buckets?: Json | null
          created_at?: string
          id?: string
          prop_hit_rate?: number | null
          prop_hits?: number
          prop_total?: number
          risk_label_buckets?: Json | null
          slip_hit_rate?: number | null
          slip_hits?: number
          slip_total?: number
          snapshot_date: string
          stat_type_buckets?: Json | null
          value_buckets?: Json | null
        }
        Update: {
          confidence_buckets?: Json | null
          created_at?: string
          id?: string
          prop_hit_rate?: number | null
          prop_hits?: number
          prop_total?: number
          risk_label_buckets?: Json | null
          slip_hit_rate?: number | null
          slip_hits?: number
          slip_total?: number
          snapshot_date?: string
          stat_type_buckets?: Json | null
          value_buckets?: Json | null
        }
        Relationships: []
      }
      factor_analysis_snapshots: {
        Row: {
          analysis_date: string
          created_at: string
          factor_performance: Json
          id: string
          lookback_days: number
          overstatement_analysis: Json
          recommendations: Json
          sample_size: number
          score_range_performance: Json
        }
        Insert: {
          analysis_date?: string
          created_at?: string
          factor_performance?: Json
          id?: string
          lookback_days?: number
          overstatement_analysis?: Json
          recommendations?: Json
          sample_size?: number
          score_range_performance?: Json
        }
        Update: {
          analysis_date?: string
          created_at?: string
          factor_performance?: Json
          id?: string
          lookback_days?: number
          overstatement_analysis?: Json
          recommendations?: Json
          sample_size?: number
          score_range_performance?: Json
        }
        Relationships: []
      }
      favorite_players: {
        Row: {
          created_at: string
          id: string
          player_id: number
          player_name: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_id: number
          player_name?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          player_id?: number
          player_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      game_odds_snapshots: {
        Row: {
          away_odds: string | null
          away_team: string
          game_date: string
          home_odds: string | null
          home_team: string
          id: string
          line: number | null
          market_type: string
          over_odds: string | null
          snapshot_at: string
          sportsbook: string
          under_odds: string | null
        }
        Insert: {
          away_odds?: string | null
          away_team: string
          game_date?: string
          home_odds?: string | null
          home_team: string
          id?: string
          line?: number | null
          market_type: string
          over_odds?: string | null
          snapshot_at?: string
          sportsbook?: string
          under_odds?: string | null
        }
        Update: {
          away_odds?: string | null
          away_team?: string
          game_date?: string
          home_odds?: string | null
          home_team?: string
          id?: string
          line?: number | null
          market_type?: string
          over_odds?: string | null
          snapshot_at?: string
          sportsbook?: string
          under_odds?: string | null
        }
        Relationships: []
      }
      games_today: {
        Row: {
          away_score: number | null
          away_team_abbr: string | null
          game_date: string
          game_time: string | null
          home_score: number | null
          home_team_abbr: string | null
          id: string
          sport: string
          status: string | null
          updated_at: string
        }
        Insert: {
          away_score?: number | null
          away_team_abbr?: string | null
          game_date: string
          game_time?: string | null
          home_score?: number | null
          home_team_abbr?: string | null
          id: string
          sport?: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          away_score?: number | null
          away_team_abbr?: string | null
          game_date?: string
          game_time?: string | null
          home_score?: number | null
          home_team_abbr?: string | null
          id?: string
          sport?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      line_snapshots: {
        Row: {
          game_date: string
          id: string
          over_odds: string | null
          player_id: number | null
          player_name: string
          snapshot_at: string
          sportsbook: string
          stat_type: string
          threshold: number
          under_odds: string | null
        }
        Insert: {
          game_date?: string
          id?: string
          over_odds?: string | null
          player_id?: number | null
          player_name: string
          snapshot_at?: string
          sportsbook?: string
          stat_type: string
          threshold: number
          under_odds?: string | null
        }
        Update: {
          game_date?: string
          id?: string
          over_odds?: string | null
          player_id?: number | null
          player_name?: string
          snapshot_at?: string
          sportsbook?: string
          stat_type?: string
          threshold?: number
          under_odds?: string | null
        }
        Relationships: []
      }
      odds_cache: {
        Row: {
          away_team: string
          bookmaker_key: string
          commence_time: string | null
          created_at: string
          event_id: string
          expires_at: string
          fetched_at: string
          home_team: string
          id: string
          market_key: string
          odds_data: Json
          provider: string
          sport_key: string
          updated_at: string
        }
        Insert: {
          away_team: string
          bookmaker_key?: string
          commence_time?: string | null
          created_at?: string
          event_id: string
          expires_at?: string
          fetched_at?: string
          home_team: string
          id?: string
          market_key: string
          odds_data?: Json
          provider?: string
          sport_key: string
          updated_at?: string
        }
        Update: {
          away_team?: string
          bookmaker_key?: string
          commence_time?: string | null
          created_at?: string
          event_id?: string
          expires_at?: string
          fetched_at?: string
          home_team?: string
          id?: string
          market_key?: string
          odds_data?: Json
          provider?: string
          sport_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      pipeline_runs: {
        Row: {
          availability_records: number | null
          availability_status: string | null
          errors: string[] | null
          game_dates: string[] | null
          id: string
          line_games_processed: number | null
          line_new_snapshots: number | null
          line_status: string | null
          ran_at: string
          scoring_scored_count: number | null
          scoring_source: string | null
          scoring_status: string | null
          success: boolean
          total_duration_ms: number
        }
        Insert: {
          availability_records?: number | null
          availability_status?: string | null
          errors?: string[] | null
          game_dates?: string[] | null
          id?: string
          line_games_processed?: number | null
          line_new_snapshots?: number | null
          line_status?: string | null
          ran_at?: string
          scoring_scored_count?: number | null
          scoring_source?: string | null
          scoring_status?: string | null
          success?: boolean
          total_duration_ms?: number
        }
        Update: {
          availability_records?: number | null
          availability_status?: string | null
          errors?: string[] | null
          game_dates?: string[] | null
          id?: string
          line_games_processed?: number | null
          line_new_snapshots?: number | null
          line_status?: string | null
          ran_at?: string
          scoring_scored_count?: number | null
          scoring_source?: string | null
          scoring_status?: string | null
          success?: boolean
          total_duration_ms?: number
        }
        Relationships: []
      }
      player_availability: {
        Row: {
          confidence: string | null
          game_date: string
          id: string
          player_id: number
          player_name: string
          reason: string | null
          source: string | null
          status: string
          team_abbr: string | null
          updated_at: string
        }
        Insert: {
          confidence?: string | null
          game_date?: string
          id?: string
          player_id: number
          player_name: string
          reason?: string | null
          source?: string | null
          status?: string
          team_abbr?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: string | null
          game_date?: string
          id?: string
          player_id?: number
          player_name?: string
          reason?: string | null
          source?: string | null
          status?: string
          team_abbr?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      player_prop_scores: {
        Row: {
          away_avg: number | null
          away_games: number | null
          away_hit_rate: number | null
          confidence_score: number | null
          consistency_score: number | null
          game_date: string
          home_avg: number | null
          home_away: string | null
          home_games: number | null
          home_hit_rate: number | null
          id: string
          last10_avg: number | null
          last10_hit_rate: number | null
          last15_avg: number | null
          last15_hit_rate: number | null
          last3_avg: number | null
          last5_avg: number | null
          last5_hit_rate: number | null
          opponent_abbr: string | null
          player_id: number
          player_name: string
          reason_tags: Json | null
          scored_at: string
          season_avg: number | null
          season_hit_rate: number | null
          stat_type: string
          team_abbr: string | null
          threshold: number
          total_games: number | null
          value_score: number | null
          volatility_score: number | null
          vs_opponent_avg: number | null
          vs_opponent_games: number | null
          vs_opponent_hit_rate: number | null
        }
        Insert: {
          away_avg?: number | null
          away_games?: number | null
          away_hit_rate?: number | null
          confidence_score?: number | null
          consistency_score?: number | null
          game_date?: string
          home_avg?: number | null
          home_away?: string | null
          home_games?: number | null
          home_hit_rate?: number | null
          id?: string
          last10_avg?: number | null
          last10_hit_rate?: number | null
          last15_avg?: number | null
          last15_hit_rate?: number | null
          last3_avg?: number | null
          last5_avg?: number | null
          last5_hit_rate?: number | null
          opponent_abbr?: string | null
          player_id: number
          player_name: string
          reason_tags?: Json | null
          scored_at?: string
          season_avg?: number | null
          season_hit_rate?: number | null
          stat_type: string
          team_abbr?: string | null
          threshold: number
          total_games?: number | null
          value_score?: number | null
          volatility_score?: number | null
          vs_opponent_avg?: number | null
          vs_opponent_games?: number | null
          vs_opponent_hit_rate?: number | null
        }
        Update: {
          away_avg?: number | null
          away_games?: number | null
          away_hit_rate?: number | null
          confidence_score?: number | null
          consistency_score?: number | null
          game_date?: string
          home_avg?: number | null
          home_away?: string | null
          home_games?: number | null
          home_hit_rate?: number | null
          id?: string
          last10_avg?: number | null
          last10_hit_rate?: number | null
          last15_avg?: number | null
          last15_hit_rate?: number | null
          last3_avg?: number | null
          last5_avg?: number | null
          last5_hit_rate?: number | null
          opponent_abbr?: string | null
          player_id?: number
          player_name?: string
          reason_tags?: Json | null
          scored_at?: string
          season_avg?: number | null
          season_hit_rate?: number | null
          stat_type?: string
          team_abbr?: string | null
          threshold?: number
          total_games?: number | null
          value_score?: number | null
          volatility_score?: number | null
          vs_opponent_avg?: number | null
          vs_opponent_games?: number | null
          vs_opponent_hit_rate?: number | null
        }
        Relationships: []
      }
      player_recent_games: {
        Row: {
          ast: number | null
          blk: number | null
          fg3m: number | null
          game_date: string
          game_id: string
          matchup: string | null
          player_id: number
          player_name: string | null
          pts: number | null
          reb: number | null
          sport: string
          stl: number | null
          team_abbr: string | null
          updated_at: string
          wl: string | null
        }
        Insert: {
          ast?: number | null
          blk?: number | null
          fg3m?: number | null
          game_date: string
          game_id: string
          matchup?: string | null
          player_id: number
          player_name?: string | null
          pts?: number | null
          reb?: number | null
          sport?: string
          stl?: number | null
          team_abbr?: string | null
          updated_at?: string
          wl?: string | null
        }
        Update: {
          ast?: number | null
          blk?: number | null
          fg3m?: number | null
          game_date?: string
          game_id?: string
          matchup?: string | null
          player_id?: number
          player_name?: string | null
          pts?: number | null
          reb?: number | null
          sport?: string
          stl?: number | null
          team_abbr?: string | null
          updated_at?: string
          wl?: string | null
        }
        Relationships: []
      }
      premium_waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          source: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          source?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          source?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      prop_outcomes: {
        Row: {
          actual_value: number | null
          confidence_score: number | null
          consistency_score: number | null
          created_at: string
          game_date: string
          graded_at: string | null
          hit: boolean | null
          home_away: string | null
          id: string
          line_hit_rate_l10: number | null
          line_hit_rate_season: number | null
          opponent_abbr: string | null
          player_id: number
          player_name: string
          reason_tags: Json | null
          source: string | null
          stat_type: string
          team_abbr: string | null
          threshold: number
          value_score: number | null
          volatility_score: number | null
        }
        Insert: {
          actual_value?: number | null
          confidence_score?: number | null
          consistency_score?: number | null
          created_at?: string
          game_date: string
          graded_at?: string | null
          hit?: boolean | null
          home_away?: string | null
          id?: string
          line_hit_rate_l10?: number | null
          line_hit_rate_season?: number | null
          opponent_abbr?: string | null
          player_id: number
          player_name: string
          reason_tags?: Json | null
          source?: string | null
          stat_type: string
          team_abbr?: string | null
          threshold: number
          value_score?: number | null
          volatility_score?: number | null
        }
        Update: {
          actual_value?: number | null
          confidence_score?: number | null
          consistency_score?: number | null
          created_at?: string
          game_date?: string
          graded_at?: string | null
          hit?: boolean | null
          home_away?: string | null
          id?: string
          line_hit_rate_l10?: number | null
          line_hit_rate_season?: number | null
          opponent_abbr?: string | null
          player_id?: number
          player_name?: string
          reason_tags?: Json | null
          source?: string | null
          stat_type?: string
          team_abbr?: string | null
          threshold?: number
          value_score?: number | null
          volatility_score?: number | null
        }
        Relationships: []
      }
      refresh_status: {
        Row: {
          id: number
          last_run: string | null
          sport: string | null
        }
        Insert: {
          id: number
          last_run?: string | null
          sport?: string | null
        }
        Update: {
          id?: number
          last_run?: string | null
          sport?: string | null
        }
        Relationships: []
      }
      saved_slips: {
        Row: {
          created_at: string
          id: string
          slip_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          slip_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          slip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_slips_slip_id_fkey"
            columns: ["slip_id"]
            isOneToOne: false
            referencedRelation: "ai_slips"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_weights: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          label: string
          notes: string | null
          version: number
          weights: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string
          notes?: string | null
          version?: number
          weights?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string
          notes?: string | null
          version?: number
          weights?: Json
        }
        Relationships: []
      }
      slip_leg_outcomes: {
        Row: {
          actual_value: number | null
          books_count: number | null
          confidence_score: number | null
          created_at: string
          hit: boolean | null
          id: string
          leg_order: number
          pick: string
          player_name: string
          slip_outcome_id: string
          stat_type: string
          team_abbr: string | null
          threshold: number
          value_score: number | null
        }
        Insert: {
          actual_value?: number | null
          books_count?: number | null
          confidence_score?: number | null
          created_at?: string
          hit?: boolean | null
          id?: string
          leg_order?: number
          pick: string
          player_name: string
          slip_outcome_id: string
          stat_type: string
          team_abbr?: string | null
          threshold: number
          value_score?: number | null
        }
        Update: {
          actual_value?: number | null
          books_count?: number | null
          confidence_score?: number | null
          created_at?: string
          hit?: boolean | null
          id?: string
          leg_order?: number
          pick?: string
          player_name?: string
          slip_outcome_id?: string
          stat_type?: string
          team_abbr?: string | null
          threshold?: number
          value_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "slip_leg_outcomes_slip_outcome_id_fkey"
            columns: ["slip_outcome_id"]
            isOneToOne: false
            referencedRelation: "slip_outcomes"
            referencedColumns: ["id"]
          },
        ]
      }
      slip_outcomes: {
        Row: {
          created_at: string
          estimated_odds: string | null
          first_failed_leg: number | null
          game_date: string
          graded_at: string | null
          id: string
          leg_count: number
          legs_hit: number | null
          prompt: string | null
          risk_label: string
          slip_hit: boolean | null
          slip_id: string | null
          slip_name: string
        }
        Insert: {
          created_at?: string
          estimated_odds?: string | null
          first_failed_leg?: number | null
          game_date?: string
          graded_at?: string | null
          id?: string
          leg_count?: number
          legs_hit?: number | null
          prompt?: string | null
          risk_label: string
          slip_hit?: boolean | null
          slip_id?: string | null
          slip_name: string
        }
        Update: {
          created_at?: string
          estimated_odds?: string | null
          first_failed_leg?: number | null
          game_date?: string
          graded_at?: string | null
          id?: string
          leg_count?: number
          legs_hit?: number | null
          prompt?: string | null
          risk_label?: string
          slip_hit?: boolean | null
          slip_id?: string | null
          slip_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "slip_outcomes_slip_id_fkey"
            columns: ["slip_id"]
            isOneToOne: false
            referencedRelation: "ai_slips"
            referencedColumns: ["id"]
          },
        ]
      }
      streak_events: {
        Row: {
          created_at: string
          entity_type: string
          event_type: string
          id: string
          last_game: string | null
          new_streak_len: number | null
          player_id: number | null
          player_name: string | null
          prev_streak_len: number | null
          sport: string
          stat: string
          team_abbr: string | null
          threshold: number
        }
        Insert: {
          created_at?: string
          entity_type: string
          event_type: string
          id?: string
          last_game?: string | null
          new_streak_len?: number | null
          player_id?: number | null
          player_name?: string | null
          prev_streak_len?: number | null
          sport?: string
          stat: string
          team_abbr?: string | null
          threshold: number
        }
        Update: {
          created_at?: string
          entity_type?: string
          event_type?: string
          id?: string
          last_game?: string | null
          new_streak_len?: number | null
          player_id?: number | null
          player_name?: string | null
          prev_streak_len?: number | null
          sport?: string
          stat?: string
          team_abbr?: string | null
          threshold?: number
        }
        Relationships: []
      }
      streaks: {
        Row: {
          entity_type: string
          id: string
          last_game: string
          last10_games: number | null
          last10_hit_pct: number | null
          last10_hits: number | null
          last15_games: number | null
          last15_hit_pct: number | null
          last15_hits: number | null
          last20_games: number | null
          last20_hit_pct: number | null
          last20_hits: number | null
          last5_games: number | null
          last5_hit_pct: number | null
          last5_hits: number | null
          player_id: number
          player_name: string
          season_games: number
          season_win_pct: number
          season_wins: number
          sport: string
          stat: string
          streak_len: number
          streak_start: string
          streak_win_pct: number
          team_abbr: string | null
          threshold: number
          updated_at: string
        }
        Insert: {
          entity_type?: string
          id?: string
          last_game: string
          last10_games?: number | null
          last10_hit_pct?: number | null
          last10_hits?: number | null
          last15_games?: number | null
          last15_hit_pct?: number | null
          last15_hits?: number | null
          last20_games?: number | null
          last20_hit_pct?: number | null
          last20_hits?: number | null
          last5_games?: number | null
          last5_hit_pct?: number | null
          last5_hits?: number | null
          player_id: number
          player_name: string
          season_games: number
          season_win_pct: number
          season_wins: number
          sport?: string
          stat: string
          streak_len: number
          streak_start: string
          streak_win_pct: number
          team_abbr?: string | null
          threshold: number
          updated_at?: string
        }
        Update: {
          entity_type?: string
          id?: string
          last_game?: string
          last10_games?: number | null
          last10_hit_pct?: number | null
          last10_hits?: number | null
          last15_games?: number | null
          last15_hit_pct?: number | null
          last15_hits?: number | null
          last20_games?: number | null
          last20_hit_pct?: number | null
          last20_hits?: number | null
          last5_games?: number | null
          last5_hit_pct?: number | null
          last5_hits?: number | null
          player_id?: number
          player_name?: string
          season_games?: number
          season_win_pct?: number
          season_wins?: number
          sport?: string
          stat?: string
          streak_len?: number
          streak_start?: string
          streak_win_pct?: number
          team_abbr?: string | null
          threshold?: number
          updated_at?: string
        }
        Relationships: []
      }
      stripe_customers: {
        Row: {
          created_at: string
          stripe_customer_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          stripe_customer_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          stripe_customer_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      stripe_subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          price_id: string | null
          status: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          price_id?: string | null
          status?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          price_id?: string | null
          status?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      team_recent_games: {
        Row: {
          game_date: string
          game_id: string
          matchup: string | null
          pts: number | null
          sport: string
          team_abbr: string | null
          team_id: number
          updated_at: string
          wl: string | null
        }
        Insert: {
          game_date: string
          game_id: string
          matchup?: string | null
          pts?: number | null
          sport?: string
          team_abbr?: string | null
          team_id: number
          updated_at?: string
          wl?: string | null
        }
        Update: {
          game_date?: string
          game_id?: string
          matchup?: string | null
          pts?: number | null
          sport?: string
          team_abbr?: string | null
          team_id?: number
          updated_at?: string
          wl?: string | null
        }
        Relationships: []
      }
      user_flags: {
        Row: {
          created_at: string
          is_admin: boolean
          is_premium: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_admin?: boolean
          is_premium?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_admin?: boolean
          is_premium?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      watchlist_items: {
        Row: {
          created_at: string
          entity_type: string
          id: string
          player_id: number | null
          sport: string
          stat: string
          team_abbr: string | null
          threshold: number
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          id?: string
          player_id?: number | null
          sport?: string
          stat: string
          team_abbr?: string | null
          threshold: number
          user_id: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          id?: string
          player_id?: number | null
          sport?: string
          stat?: string
          team_abbr?: string | null
          threshold?: number
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
