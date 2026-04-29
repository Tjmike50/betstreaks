-- AI slip security hardening
-- - Removes a leftover debug table if it still exists.
-- - Tightens ai_slip_legs reads so only authenticated owners of the parent slip
--   can read legs from the database.
-- - Preserves anonymous AI Builder creation flows by leaving parent-based insert
--   behavior intact.
--
-- Important context:
-- Logged-out AI Builder users receive generated slip/leg data directly from the
-- edge-function response. They do not need anonymous SELECT access to
-- public.ai_slip_legs after creation.
--
-- This migration intentionally does NOT:
-- - change ai_slips anonymous insert behavior
-- - change Saved Slips policies
-- - touch NBA/MLB application logic

drop table if exists public.tmp_strikeouts_before;

do $$
begin
  if to_regclass('public.ai_slip_legs') is not null then
    execute 'drop policy if exists "read slip legs" on public.ai_slip_legs';
    execute 'drop policy if exists "read slip legs via parent" on public.ai_slip_legs';

    execute $policy$
      create policy "read slip legs via parent"
      on public.ai_slip_legs
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.ai_slips s
          where s.id = ai_slip_legs.slip_id
            and s.user_id = auth.uid()
        )
      )
    $policy$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.ai_slip_legs') is not null
     and not exists (
       select 1
       from pg_policies
       where schemaname = 'public'
         and tablename = 'ai_slip_legs'
         and policyname = 'insert slip legs via parent'
     ) then
    execute $policy$
      create policy "insert slip legs via parent"
      on public.ai_slip_legs
      for insert
      with check (
        exists (
          select 1
          from public.ai_slips s
          where s.id = ai_slip_legs.slip_id
            and (
              s.user_id = auth.uid()
              or s.user_id is null
            )
        )
      )
    $policy$;
  end if;
end $$;
