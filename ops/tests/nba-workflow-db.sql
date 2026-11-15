\set ON_ERROR_STOP on
begin;

create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
insert into auth.users values
  ('90000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000002');
\ir ../../supabase/migrations/20261114090000_nba_research_workflow.sql
\ir ../../supabase/migrations/20261114100000_nba_workflow_feed_retention.sql

do $$
begin
  if has_table_privilege('authenticated', 'public.nba_workflow_accounts', 'select')
    or has_table_privilege('anon', 'public.nba_workflow_snapshot', 'select')
    or has_function_privilege('authenticated', 'public.reserve_nba_workflow_model(uuid,integer,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.publish_nba_workflow_snapshot(jsonb)', 'execute')
    or has_function_privilege('anon', 'public.next_nba_workflow_watch_accounts()', 'execute')
    or has_function_privilege('authenticated', 'public.referenced_nba_workflow_markets(text[])', 'execute') then
    raise exception 'Unexpected public data or worker access';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  first_id uuid := '90000000-0000-4000-8000-000000000001';
  second_id uuid := '90000000-0000-4000-8000-000000000002';
  latest jsonb := '{"board":{"asOf":"2026-02-02T12:00:00.000Z","snapshot":{"mode":"verified"}}}';
  caught boolean := false;
begin
  if not public.reserve_nba_workflow_model(first_id, 2, 1) then raise exception 'initial reservation failed'; end if;
  if public.reserve_nba_workflow_model(first_id, 2, 1) then raise exception 'per-user limit bypassed'; end if;
  if not public.reserve_nba_workflow_model(second_id, 2, 2) then raise exception 'global budget consumed by denied request'; end if;
  if public.reserve_nba_workflow_model(second_id, 2, 2) then raise exception 'global limit bypassed'; end if;

  if not public.publish_nba_workflow_snapshot(latest) or not public.publish_nba_workflow_snapshot(latest) then
    raise exception 'publishing or retry failed';
  end if;
  if public.publish_nba_workflow_snapshot('{"board":{"asOf":"2026-02-01T12:00:00.000Z","snapshot":{"mode":"verified"}}}') then
    raise exception 'an older snapshot replaced the current one';
  end if;
  if public.publish_nba_workflow_snapshot('{"board":{"asOf":"2026-02-03T12:00:00.000Z","snapshot":{"mode":"fixture"}}}') then
    raise exception 'fixture entered the verified source';
  end if;

  insert into public.nba_workflow_accounts(user_id, version, state) values
    (first_id, 1, '{"watch":[{"leg":{"id":"fixture-watch"}}],"slips":[{"legs":[{"id":"fixture-slip"}]}],"preferences":{"enabled":false},"subscription":null}'),
    (second_id, 1, '{"watch":[],"preferences":{"enabled":true},"subscription":{"endpoint":"test"}}');
  if (select array_agg(x) from public.next_nba_workflow_watch_accounts() as x) is distinct from array[first_id] then
    raise exception 'watched account batch failure';
  end if;

  if public.referenced_nba_workflow_markets(array['fixture-slip', 'fixture-watch', 'unused']) <>
      '["fixture-slip","fixture-watch"]'::jsonb then
    raise exception 'market retention does not match saved slips and watched markets';
  end if;

  insert into public.nba_workflow_push_claims(user_id, event_id) values (first_id, 'result');
  begin
    insert into public.nba_workflow_push_claims(user_id, event_id) values (first_id, 'result');
  exception when unique_violation then caught := true;
  end;
  if not caught then raise exception 'duplicate notification claim allowed'; end if;
end;
$$;

rollback;
