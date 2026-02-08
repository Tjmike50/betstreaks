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
