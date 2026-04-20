UPDATE public.ai_daily_pick_legs l
SET team_abbr = pps.team_abbr
FROM public.ai_daily_picks p,
     public.player_prop_scores pps
WHERE l.daily_pick_id = p.id
  AND p.sport = 'MLB'
  AND p.pick_date = CURRENT_DATE
  AND pps.sport = 'MLB'
  AND pps.game_date = CURRENT_DATE
  AND pps.player_name = l.player_name
  AND pps.stat_type = l.stat_type
  AND l.team_abbr IS NULL
  AND pps.team_abbr IS NOT NULL;