

## Grant Premium to topguard71@gmail.com

### Found
- **Email**: topguard71@gmail.com
- **User ID**: `0ce73cbf-e772-4bc5-8ce5-8dd4d16b893d`
- **Current status**: No `user_flags` record exists (not premium)

### Action
Insert a single row into `user_flags` using the Supabase insert tool:

```sql
INSERT INTO user_flags (user_id, is_premium, is_admin)
VALUES ('0ce73cbf-e772-4bc5-8ce5-8dd4d16b893d', true, false);
```

This grants immediate premium access. No code changes needed — the existing `usePremiumStatus` hook will pick it up on their next page load.

