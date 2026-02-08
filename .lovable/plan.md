
# Fix Stripe Subscription Edge Functions

## Problem Identified
During testing, the checkout flow failed with error: **`"supabaseKey is required."`**

This is caused by the edge functions using an incorrect environment variable name: `SUPABASE_PUBLISHABLE_KEY` instead of `SUPABASE_ANON_KEY`.

Supabase automatically provides these environment variables to edge functions:
- `SUPABASE_URL` ✓
- `SUPABASE_ANON_KEY` (the correct name for the publishable/anon key)
- `SUPABASE_SERVICE_ROLE_KEY` ✓

The code currently references `SUPABASE_PUBLISHABLE_KEY` which doesn't exist.

## Files to Fix

### 1. `supabase/functions/create-checkout-session/index.ts`
**Line 33**: Change `SUPABASE_PUBLISHABLE_KEY` → `SUPABASE_ANON_KEY`

```typescript
// Before
Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",

// After  
Deno.env.get("SUPABASE_ANON_KEY") ?? "",
```

### 2. `supabase/functions/create-portal-session/index.ts`
**Line 26**: Change `SUPABASE_PUBLISHABLE_KEY` → `SUPABASE_ANON_KEY`

```typescript
// Before
Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",

// After
Deno.env.get("SUPABASE_ANON_KEY") ?? "",
```

## After the Fix
Once approved, I will:
1. Update both edge functions with the correct environment variable name
2. Redeploy the functions
3. Test the subscription flow again to verify it redirects to Stripe Checkout

## Technical Context
- The `SUPABASE_ANON_KEY` is the public/anon key used for client-side operations
- It's automatically available in all Supabase edge functions without needing to configure secrets
- The `stripe-webhook` function is unaffected as it only uses the service role key
