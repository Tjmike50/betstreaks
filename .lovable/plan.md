
The user wants to grant premium status to mykalaadams17@gmail.com. This requires:
1. Looking up the user's UUID in auth.users (via a server-side query)
2. Upserting a row into `user_flags` with `is_premium = true`

The `user_flags` table only has SELECT RLS for own rows — no public INSERT/UPDATE policy. I'll need to use the data insert tool which runs with elevated privileges.

This is a simple, single-step admin action. No code changes needed.

## Plan: Grant Premium to mykalaadams17@gmail.com

### What
Set `is_premium = true` in the `user_flags` table for the user with email `mykalaadams17@gmail.com`.

### Steps
1. Look up the user's UUID from `auth.users` by email
2. Upsert a row into `public.user_flags` with `user_id = <that uuid>`, `is_premium = true`, preserving any existing `is_admin` value
3. Confirm the change by reading back the row

### SQL
```sql
INSERT INTO public.user_flags (user_id, is_premium, updated_at)
SELECT id, true, now()
FROM auth.users
WHERE email = 'mykalaadams17@gmail.com'
ON CONFLICT (user_id) DO UPDATE
SET is_premium = true, updated_at = now();
```

### Notes
- If the email doesn't exist in `auth.users`, the INSERT will affect 0 rows and I'll report back so you can confirm the account exists / was created
- No code or schema changes — pure data update
- The user will see premium features unlock on next page load (or after `refetch()` in `usePremiumStatus`)
