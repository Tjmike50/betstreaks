
-- Tighten ai_slip_legs policies: only allow insert/read via service role or if parent slip belongs to user
DROP POLICY "read slip legs" ON public.ai_slip_legs;
DROP POLICY "insert slip legs" ON public.ai_slip_legs;

CREATE POLICY "read slip legs via parent" ON public.ai_slip_legs FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.ai_slips s WHERE s.id = slip_id AND (s.user_id = auth.uid() OR s.user_id IS NULL))
);

CREATE POLICY "insert slip legs via parent" ON public.ai_slip_legs FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.ai_slips s WHERE s.id = slip_id AND (s.user_id = auth.uid() OR s.user_id IS NULL))
);
