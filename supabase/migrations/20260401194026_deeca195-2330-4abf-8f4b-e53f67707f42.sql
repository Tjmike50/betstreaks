CREATE TABLE public.pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  success boolean NOT NULL DEFAULT false,
  total_duration_ms integer NOT NULL DEFAULT 0,
  line_status text,
  line_new_snapshots integer,
  line_games_processed integer,
  availability_status text,
  availability_records integer,
  scoring_status text,
  scoring_scored_count integer,
  scoring_source text,
  errors text[] DEFAULT '{}',
  game_dates text[] DEFAULT '{}'
);

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read pipeline runs"
  ON public.pipeline_runs
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX idx_pipeline_runs_ran_at ON public.pipeline_runs (ran_at DESC);