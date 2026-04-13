INSERT INTO public.user_flags (user_id, is_premium, is_admin, created_at, updated_at)
VALUES ('fa53b77a-e3f2-45ae-bb4a-9551f5faf9a0', true, false, now(), now())
ON CONFLICT (user_id) DO UPDATE SET is_premium = true, updated_at = now();