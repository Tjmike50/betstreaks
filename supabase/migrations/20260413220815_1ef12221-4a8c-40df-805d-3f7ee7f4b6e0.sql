INSERT INTO public.user_flags (user_id, is_premium, is_admin, created_at, updated_at)
VALUES ('6083bacc-035d-4d34-b5cd-09783040f8a0', true, false, now(), now())
ON CONFLICT (user_id) DO UPDATE SET is_premium = true, updated_at = now();