CREATE TABLE public.mlb_performance_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport text NOT NULL DEFAULT 'MLB',
  summary_date date NOT NULL,
  summary_window text NOT NULL,
  group_type text NOT NULL,
  group_key text NOT NULL,
  total_count integer NOT NULL DEFAULT 0,
  graded_count integer NOT NULL DEFAULT 0,
  hit_count integer NOT NULL DEFAULT 0,
  miss_count integer NOT NULL DEFAULT 0,
  push_count integer NOT NULL DEFAULT 0,
  pending_count integer NOT NULL DEFAULT 0,
  void_count integer NOT NULL DEFAULT 0,
  hit_rate numeric,
  push_adjusted_hit_rate numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sport, summary_date, summary_window, group_type, group_key)
);

ALTER TABLE public.mlb_performance_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read mlb performance summaries"
  ON public.mlb_performance_summaries FOR SELECT
  USING (true);

CREATE POLICY "service role write mlb performance summaries"
  ON public.mlb_performance_summaries
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_mlb_performance_summaries_summary_date
  ON public.mlb_performance_summaries(summary_date);

CREATE INDEX idx_mlb_performance_summaries_window_group
  ON public.mlb_performance_summaries(summary_window, group_type, group_key);
