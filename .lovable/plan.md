

## Set Admin Flag for Your Account

Since you already have an account, I just need to identify it and flip the admin flag.

### Steps

1. **Look up your user ID** in the `user_flags` table using your Supabase user ID
2. **Upsert a row** in `user_flags` with `is_admin = true` for your user ID
3. **Verify** you can access `/admin/eval` and see the Admin Refresh button

### What I need from you

- Your **email address** or **Supabase user ID** so I can target the correct row

### No code changes required

This is a data-only operation — just an `UPDATE` or `INSERT` on the `user_flags` table. The app already checks `user_flags.is_admin` via `useAdmin()` hook and the `is_admin()` DB function.

