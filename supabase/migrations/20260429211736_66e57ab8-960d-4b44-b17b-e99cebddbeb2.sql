INSERT INTO public.user_flags (user_id, is_premium)
VALUES ('6ffada30-9a6a-44ea-927d-1f6385fc0d2f', true)
ON CONFLICT (user_id)
DO UPDATE SET is_premium = true, updated_at = now();