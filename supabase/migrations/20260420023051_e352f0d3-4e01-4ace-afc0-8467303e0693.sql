INSERT INTO public.user_flags (user_id, is_premium, is_admin)
VALUES ('5c41e8bf-c302-4348-98d8-9058fed415e9', true, false)
ON CONFLICT (user_id) DO UPDATE SET is_premium = true, updated_at = now();