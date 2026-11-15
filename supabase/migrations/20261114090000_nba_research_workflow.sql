-- Opt-in NBA research data. Only trusted Edge code and the approved snapshot publisher can read/write these tables.
create table public.nba_workflow_snapshot (
  id boolean primary key default true check (id),
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);

create table public.nba_workflow_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  state jsonb not null check (jsonb_typeof(state) = 'object' and pg_column_size(state) < 524288)
);

create table public.nba_workflow_feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  reference uuid not null,
  reason text not null check (reason in ('data', 'match', 'answer')),
  created_at timestamptz not null default now(),
  primary key (user_id, reference, reason)
);

create table public.nba_workflow_model_global (
  day date primary key,
  calls integer not null check (calls >= 0)
);
create table public.nba_workflow_model_users (
  day date not null references public.nba_workflow_model_global(day) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  calls integer not null check (calls >= 0),
  primary key (day, user_id)
);

alter table public.nba_workflow_snapshot enable row level security;
alter table public.nba_workflow_accounts enable row level security;
alter table public.nba_workflow_feedback enable row level security;
alter table public.nba_workflow_model_global enable row level security;
alter table public.nba_workflow_model_users enable row level security;

revoke all on public.nba_workflow_snapshot, public.nba_workflow_accounts, public.nba_workflow_feedback,
  public.nba_workflow_model_global, public.nba_workflow_model_users from public, anon, authenticated;
grant select, insert, update, delete on public.nba_workflow_snapshot, public.nba_workflow_accounts,
  public.nba_workflow_feedback, public.nba_workflow_model_global, public.nba_workflow_model_users to service_role;

create function public.reserve_nba_workflow_model(p_user uuid, p_global_limit integer, p_user_limit integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  today date := (now() at time zone 'UTC')::date;
  global_calls integer;
  user_calls integer;
begin
  if p_global_limit is null or p_user_limit is null or p_global_limit not between 1 and 10000
    or p_user_limit not between 1 and 1000 then
    return false;
  end if;
  insert into public.nba_workflow_model_global(day, calls) values (today, 0)
    on conflict (day) do nothing;
  select calls into global_calls from public.nba_workflow_model_global where day = today for update;
  if global_calls >= p_global_limit then return false; end if;

  select calls into user_calls from public.nba_workflow_model_users where day = today and user_id = p_user;
  if coalesce(user_calls, 0) >= p_user_limit then return false; end if;

  update public.nba_workflow_model_global set calls = calls + 1 where day = today;
  insert into public.nba_workflow_model_users(day, user_id, calls) values (today, p_user, 1)
    on conflict (day, user_id) do update set calls = public.nba_workflow_model_users.calls + 1;
  return true;
end;
$$;

revoke all on function public.reserve_nba_workflow_model(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_nba_workflow_model(uuid, integer, integer) to service_role;

create table public.nba_workflow_push_cursor (
  id boolean primary key default true check (id),
  last_user uuid
);
create table public.nba_workflow_push_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null check (length(event_id) <= 1024),
  claimed_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
create index on public.nba_workflow_push_claims (claimed_at);
alter table public.nba_workflow_push_cursor enable row level security;
alter table public.nba_workflow_push_claims enable row level security;
revoke all on public.nba_workflow_push_cursor, public.nba_workflow_push_claims from public, anon, authenticated;
grant select, insert, update, delete on public.nba_workflow_push_cursor, public.nba_workflow_push_claims to service_role;

create function public.next_nba_workflow_watch_accounts()
returns setof uuid
language plpgsql
set search_path = ''
as $$
declare
  cursor_id uuid;
  next_accounts uuid[];
begin
  insert into public.nba_workflow_push_cursor(id) values (true) on conflict (id) do nothing;
  select last_user into cursor_id from public.nba_workflow_push_cursor where id = true for update;

  select array_agg(user_id order by user_id) into next_accounts
  from (
    select user_id
    from public.nba_workflow_accounts
    where (cursor_id is null or user_id > cursor_id)
      and jsonb_array_length(state->'watch') > 0
    order by user_id
    limit 24
  ) as batch;

  update public.nba_workflow_push_cursor
  set last_user = case when cardinality(next_accounts) = 24 then next_accounts[24] end
  where id = true;
  return query select unnest(next_accounts);
end;
$$;

revoke all on function public.next_nba_workflow_watch_accounts() from public, anon, authenticated;
grant execute on function public.next_nba_workflow_watch_accounts() to service_role;

create function public.publish_nba_workflow_snapshot(p_payload jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload->'board'->'snapshot'->>'mode' is distinct from 'verified'
    or p_payload->'board'->>'asOf' is null
    or (p_payload->'board'->>'asOf')::timestamptz > now() then
    return false;
  end if;

  insert into public.nba_workflow_snapshot(id, payload)
  values (true, p_payload)
  on conflict (id) do update set payload = excluded.payload
  where (public.nba_workflow_snapshot.payload->'board'->>'asOf')::timestamptz
    < (excluded.payload->'board'->>'asOf')::timestamptz
    or public.nba_workflow_snapshot.payload = excluded.payload;
  return found;
end;
$$;

revoke all on function public.publish_nba_workflow_snapshot(jsonb) from public, anon, authenticated;
grant execute on function public.publish_nba_workflow_snapshot(jsonb) to service_role;
