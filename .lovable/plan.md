
# Plan: Stripe Subscriptions for BetStreaks Premium (Web)

## Overview
Implement Stripe-powered subscription billing for the web version of BetStreaks. When users purchase Premium via Stripe Checkout, their `user_flags.is_premium` flag is set to `true`. When canceled or expired, it reverts to `false`.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  /premium page                                                               │
│  ┌────────────────────────────────────────┐                                 │
│  │  [Go Premium Monthly - $9.99/mo]       │──► create-checkout-session      │
│  │  [Go Premium Yearly - $59.99/yr]       │    (Edge Function)              │
│  │                                         │         │                       │
│  │  Already Premium?                       │         ▼                       │
│  │  [Manage Billing]                       │──► Stripe Checkout             │
│  └────────────────────────────────────────┘         │                       │
│                                                      ▼                       │
│                                              Stripe Webhook                  │
│                                              (stripe-webhook)                │
│                                                      │                       │
│                                                      ▼                       │
│                                          ┌──────────────────────┐           │
│                                          │  user_flags          │           │
│                                          │  is_premium = true   │           │
│                                          └──────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Database Tables (Already Exist)

The required tables are already in place:

| Table | Purpose |
|-------|---------|
| `stripe_customers` | Maps `user_id` → `stripe_customer_id` |
| `stripe_subscriptions` | Stores subscription details (status, price_id, period_end) |
| `user_flags` | Contains `is_premium` boolean for premium access |

**Note**: Existing RLS policies only allow SELECT for authenticated users. The edge functions will use the **service role key** to INSERT/UPDATE these tables.

## Secrets Required

Before implementation, two Stripe secrets must be added:

| Secret | Purpose |
|--------|---------|
| `STRIPE_SECRET_KEY` | API key for Stripe operations (checkout, portal) |
| `STRIPE_WEBHOOK_SECRET` | Signature verification for webhook events |

## Edge Functions to Create

### 1. `create-checkout-session`
**Purpose**: Create a Stripe Checkout session for subscription purchase

**Flow**:
1. Verify user is authenticated via JWT
2. Look up or create Stripe customer (stores mapping in `stripe_customers`)
3. Create Checkout session with the selected price_id
4. Return checkout URL

**Inputs**: `{ priceId: string }`  
**Outputs**: `{ url: string }`

### 2. `create-portal-session`
**Purpose**: Allow users to manage their subscription (cancel, update payment)

**Flow**:
1. Verify user is authenticated via JWT
2. Look up Stripe customer ID from `stripe_customers`
3. Create Customer Portal session
4. Return portal URL

**Outputs**: `{ url: string }`

### 3. `stripe-webhook`
**Purpose**: Handle Stripe webhook events (NO auth - uses signature verification)

**Events Handled**:
- `checkout.session.completed` → Link subscription to user
- `customer.subscription.created` → Set `is_premium = true`
- `customer.subscription.updated` → Check status, update premium flag
- `customer.subscription.deleted` → Set `is_premium = false`
- `invoice.payment_failed` → (Optional) Log for alerting

**Premium Logic**:
```text
if status IN ('active', 'trialing') => is_premium = true
else => is_premium = false
```

## Frontend Changes

### 1. Update `usePremiumStatus` Hook
Query `user_flags` table for the current user's `is_premium` status:

```typescript
// Fetches is_premium from user_flags for authenticated users
const { data } = await supabase
  .from('user_flags')
  .select('is_premium')
  .eq('user_id', userId)
  .single();
```

### 2. Redesign Premium Page (`/premium`)

**For logged-out users**: Show login prompt  
**For non-premium users**: Show subscription options  
**For premium users**: Show status + Manage Billing button

```text
┌─────────────────────────────────────────┐
│           BetStreaks Premium             │
│                                          │
│   [Feature list with checkmarks]         │
│                                          │
│   ┌──────────────────────────────────┐  │
│   │  Monthly        │  Yearly        │  │
│   │  $9.99/mo       │  $59.99/yr     │  │
│   │  [Subscribe]    │  [Subscribe]   │  │
│   │                 │  Save 50%      │  │
│   └──────────────────────────────────┘  │
│                                          │
│   /premium?success=1 → Show confetti!   │
└─────────────────────────────────────────┘

For Premium Users:
┌─────────────────────────────────────────┐
│   ✓ You're a Premium member!            │
│                                          │
│   [Manage Billing]                       │
└─────────────────────────────────────────┘
```

### 3. Handle Success Redirect
When returning from Stripe Checkout with `?success=1`:
- Show success toast/confetti
- Refetch premium status
- Display confirmation message

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/create-checkout-session/index.ts` | Create | Checkout session creation |
| `supabase/functions/create-portal-session/index.ts` | Create | Customer portal session |
| `supabase/functions/stripe-webhook/index.ts` | Create | Webhook handler |
| `supabase/config.toml` | Modify | Add function configs with `verify_jwt = false` |
| `src/hooks/usePremiumStatus.ts` | Modify | Query `user_flags.is_premium` |
| `src/pages/PremiumPage.tsx` | Modify | Subscription UI with checkout buttons |

## Stripe Price IDs

You'll need to create products in Stripe Dashboard and provide the price IDs:
- **Monthly**: `price_xxxxx` ($9.99/month)
- **Yearly**: `price_yyyyy` ($59.99/year)

These will be stored as constants in the frontend.

## iOS Compatibility Note

This implementation is web-only:
- Edge functions are called from the web app only
- No changes affect potential future iOS In-App Purchase flow
- `user_flags.is_premium` can be set by either Stripe (web) or future IAP webhooks (iOS)

## Implementation Order

1. **Add Stripe secrets** (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)
2. **Create edge functions** (checkout, portal, webhook)
3. **Update usePremiumStatus hook** to query database
4. **Redesign Premium page** with subscription buttons
5. **Test end-to-end** with Stripe test mode

## Technical Details

### Webhook Signature Verification
```typescript
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const signature = req.headers.get('stripe-signature');
const body = await req.text();
const event = stripe.webhooks.constructEvent(
  body, 
  signature, 
  Deno.env.get('STRIPE_WEBHOOK_SECRET')
);
```

### Premium Flag Update Logic
```typescript
async function updatePremiumStatus(userId: string, isActive: boolean) {
  await supabase
    .from('user_flags')
    .upsert({ 
      user_id: userId, 
      is_premium: isActive,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
}
```

### Checkout Session Metadata
Store `user_id` in checkout session metadata to link subscription to user:
```typescript
const session = await stripe.checkout.sessions.create({
  customer: stripeCustomerId,
  metadata: { user_id: userId },
  // ...
});
```
