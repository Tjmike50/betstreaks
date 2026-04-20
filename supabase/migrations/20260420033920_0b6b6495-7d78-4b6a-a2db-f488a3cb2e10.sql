-- =========================================
-- MLB v1 Schema (aligned IDs + updated_at)
-- =========================================
-- ID type alignment with existing shared tables:
--   player_id  -> bigint  (matches player_recent_games, player_prop_scores, etc.)
--   team_id    -> bigint  (matches team_recent_games)
--   game_id    -> text    (matches games_today, player_recent_games, team_recent_games)

-- ---------- mlb_player_profiles ----------
CREATE TABLE public.mlb_player_profiles (
  player_id           bigint PRIMARY KEY,
  mlb_team_id         bigint,
  bats                text,
  throws              text,
  primary_role        text,
  is_probable_pitcher boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mlb_player_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read mlb player profiles"
  ON public.mlb_player_profiles FOR SELECT
  USING (true);

CREATE TRIGGER trg_mlb_player_profiles_updated_at
  BEFORE UPDATE ON public.mlb_player_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_mlb_player_profiles_team ON public.mlb_player_profiles(mlb_team_id);


-- ---------- mlb_game_context ----------
CREATE TABLE public.mlb_game_context (
  game_id                    text PRIMARY KEY,
  probable_home_pitcher_id   bigint,
  probable_away_pitcher_id   bigint,
  venue_name                 text,
  weather_json               jsonb,
  park_factor_json           jsonb,
  game_context_json          jsonb,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mlb_game_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read mlb game context"
  ON public.mlb_game_context FOR SELECT
  USING (true);

CREATE TRIGGER trg_mlb_game_context_updated_at
  BEFORE UPDATE ON public.mlb_game_context
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ---------- mlb_hitter_game_logs ----------
CREATE TABLE public.mlb_hitter_game_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id             text NOT NULL,
  player_id           bigint NOT NULL,
  team_id             bigint,
  opponent_team_id    bigint,
  game_date           date NOT NULL,
  batting_order       integer,
  plate_appearances   integer,
  at_bats             integer,
  hits                integer,
  singles             integer,
  doubles             integer,
  triples             integer,
  home_runs           integer,
  runs                integer,
  rbi                 integer,
  walks               integer,
  strikeouts          integer,
  stolen_bases        integer,
  total_bases         integer,
  is_home             boolean,
  opposing_pitcher_id bigint,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, player_id)
);

ALTER TABLE public.mlb_hitter_game_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read mlb hitter game logs"
  ON public.mlb_hitter_game_logs FOR SELECT
  USING (true);

CREATE TRIGGER trg_mlb_hitter_game_logs_updated_at
  BEFORE UPDATE ON public.mlb_hitter_game_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_mlb_hitter_logs_player_date ON public.mlb_hitter_game_logs(player_id, game_date DESC);
CREATE INDEX idx_mlb_hitter_logs_team_date   ON public.mlb_hitter_game_logs(team_id, game_date DESC);


-- ---------- mlb_pitcher_game_logs ----------
CREATE TABLE public.mlb_pitcher_game_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id               text NOT NULL,
  player_id             bigint NOT NULL,
  team_id               bigint,
  opponent_team_id      bigint,
  game_date             date NOT NULL,
  innings_pitched       numeric(4,1),
  pitch_count           integer,
  strikeouts            integer,
  earned_runs_allowed   integer,
  walks_allowed         integer,
  hits_allowed          integer,
  home_runs_allowed     integer,
  batters_faced         integer,
  is_home               boolean,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, player_id)
);

ALTER TABLE public.mlb_pitcher_game_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read mlb pitcher game logs"
  ON public.mlb_pitcher_game_logs FOR SELECT
  USING (true);

CREATE TRIGGER trg_mlb_pitcher_game_logs_updated_at
  BEFORE UPDATE ON public.mlb_pitcher_game_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_mlb_pitcher_logs_player_date ON public.mlb_pitcher_game_logs(player_id, game_date DESC);
CREATE INDEX idx_mlb_pitcher_logs_team_date   ON public.mlb_pitcher_game_logs(team_id, game_date DESC);


-- ---------- mlb_team_offense_daily ----------
CREATE TABLE public.mlb_team_offense_daily (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             bigint NOT NULL,
  as_of_date          date NOT NULL,
  window_size         integer NOT NULL,
  runs_per_game       numeric,
  hits_per_game       numeric,
  walk_rate           numeric,
  strikeout_rate      numeric,
  ops                 numeric,
  isolated_power      numeric,
  split_type          text NOT NULL DEFAULT 'overall',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, as_of_date, window_size, split_type)
);

ALTER TABLE public.mlb_team_offense_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read mlb team offense daily"
  ON public.mlb_team_offense_daily FOR SELECT
  USING (true);

CREATE TRIGGER trg_mlb_team_offense_daily_updated_at
  BEFORE UPDATE ON public.mlb_team_offense_daily
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_mlb_team_offense_team_date ON public.mlb_team_offense_daily(team_id, as_of_date DESC);


-- ---------- mlb_pitcher_matchup_summaries ----------
CREATE TABLE public.mlb_pitcher_matchup_summaries (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pitcher_id                  bigint NOT NULL,
  as_of_date                  date NOT NULL,
  window_size                 integer NOT NULL,
  hits_allowed_avg            numeric,
  walks_allowed_avg           numeric,
  earned_runs_allowed_avg     numeric,
  strikeouts_avg              numeric,
  home_runs_allowed_avg       numeric,
  vs_left_json                jsonb,
  vs_right_json               jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pitcher_id, as_of_date, window_size)
);

ALTER TABLE public.mlb_pitcher_matchup_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read mlb pitcher matchup summaries"
  ON public.mlb_pitcher_matchup_summaries FOR SELECT
  USING (true);

CREATE TRIGGER trg_mlb_pitcher_matchup_summaries_updated_at
  BEFORE UPDATE ON public.mlb_pitcher_matchup_summaries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_mlb_pitcher_matchup_pitcher_date ON public.mlb_pitcher_matchup_summaries(pitcher_id, as_of_date DESC);


-- ---------- mlb_player_prop_rolling_stats ----------
CREATE TABLE public.mlb_player_prop_rolling_stats (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           bigint NOT NULL,
  market_type_key     text NOT NULL,
  as_of_date          date NOT NULL,
  window_l5_avg       numeric,
  window_l10_avg      numeric,
  window_l15_avg      numeric,
  window_l5_hit_rate  numeric,
  window_l10_hit_rate numeric,
  window_l15_hit_rate numeric,
  home_avg            numeric,
  away_avg            numeric,
  vs_left_avg         numeric,
  vs_right_avg        numeric,
  consistency_score   numeric,
  volatility_score    numeric,
  sample_size         integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, market_type_key, as_of_date)
);

ALTER TABLE public.mlb_player_prop_rolling_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read mlb player prop rolling stats"
  ON public.mlb_player_prop_rolling_stats FOR SELECT
  USING (true);

CREATE TRIGGER trg_mlb_player_prop_rolling_stats_updated_at
  BEFORE UPDATE ON public.mlb_player_prop_rolling_stats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_mlb_prop_rolling_player_market_date
  ON public.mlb_player_prop_rolling_stats(player_id, market_type_key, as_of_date DESC);
