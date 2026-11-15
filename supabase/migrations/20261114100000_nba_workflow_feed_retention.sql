create function public.referenced_nba_workflow_markets(p_market_ids text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  with used as (
    select leg->>'id' as id
    from public.nba_workflow_accounts as account
    cross join lateral jsonb_array_elements(account.state->'slips') as slip
    cross join lateral jsonb_array_elements(slip->'legs') as leg
    union
    select watch->'leg'->>'id' as id
    from public.nba_workflow_accounts as account
    cross join lateral jsonb_array_elements(account.state->'watch') as watch
  )
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from used where id = any(p_market_ids);
$$;

revoke all on function public.referenced_nba_workflow_markets(text[]) from public, anon, authenticated;
grant execute on function public.referenced_nba_workflow_markets(text[]) to service_role;
