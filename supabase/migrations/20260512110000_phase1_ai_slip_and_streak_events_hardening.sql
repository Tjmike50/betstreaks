-- Phase 1 security cleanup:
-- 1) Remove public read access from streak_events and keep a single premium/admin read policy.
-- 2) Remove anon INSERT on ai_slips after ai-bet-builder was updated to persist
--    ai_slips / ai_slip_legs through the service-role client.
--
-- Important:
-- - Logged-out AI Builder should continue working because the edge function now
--   returns generated slip data directly and writes rows with service role.
-- - This migration intentionally does NOT touch ai_slip_legs SELECT policies.
-- - This migration intentionally does NOT touch saved_slips policies.

DO $$
BEGIN
  IF to_regclass('public.streak_events') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Public read access" ON public.streak_events';
    EXECUTE 'DROP POLICY IF EXISTS "public read access" ON public.streak_events';
    EXECUTE 'DROP POLICY IF EXISTS "premium only read streak events" ON public.streak_events';
    EXECUTE 'DROP POLICY IF EXISTS "Premium only read streak events" ON public.streak_events';
    EXECUTE 'DROP POLICY IF EXISTS "premium read streak events" ON public.streak_events';
    EXECUTE 'DROP POLICY IF EXISTS "Premium read streak events" ON public.streak_events';

    EXECUTE $policy$
      CREATE POLICY "premium only read streak events"
      ON public.streak_events
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.user_flags uf
          WHERE uf.user_id = auth.uid()
            AND uf.is_premium = true
        )
        OR public.is_admin(auth.uid())
      )
    $policy$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.ai_slips') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "insert anon ai slips" ON public.ai_slips';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Rollback SQL (manual)
--
-- DROP POLICY IF EXISTS "premium only read streak events" ON public.streak_events;
-- CREATE POLICY "Public read access" ON public.streak_events
--   FOR SELECT TO anon, authenticated USING (true);
--
-- CREATE POLICY "insert anon ai slips" ON public.ai_slips
--   FOR INSERT TO anon WITH CHECK (user_id IS NULL);
-- ---------------------------------------------------------------------------
