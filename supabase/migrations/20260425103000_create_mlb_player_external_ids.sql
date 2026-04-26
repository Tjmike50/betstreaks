CREATE TABLE public.mlb_player_external_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id bigint NOT NULL,
  player_name text,
  team_abbr text,
  provider text NOT NULL,
  external_player_id text NOT NULL,
  confidence numeric NOT NULL DEFAULT 1.0,
  source text NOT NULL DEFAULT 'mlb_stats_api',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_player_id)
);

ALTER TABLE public.mlb_player_external_ids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read mlb player external ids"
  ON public.mlb_player_external_ids FOR SELECT
  USING (true);

CREATE POLICY "service role write mlb player external ids"
  ON public.mlb_player_external_ids
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER trg_mlb_player_external_ids_updated_at
  BEFORE UPDATE ON public.mlb_player_external_ids
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_mlb_player_external_ids_player_id
  ON public.mlb_player_external_ids(player_id);
