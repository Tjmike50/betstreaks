
# Update Stripe Price IDs

## Change Summary
Replace the placeholder Stripe price IDs with your actual product IDs from your Stripe Dashboard.

## File to Modify

**`src/pages/PremiumPage.tsx`** - Lines 12-15

### Current Code:
```typescript
// TODO: Replace with actual Stripe price IDs from your Stripe Dashboard
const PRICE_IDS = {
  monthly: "price_monthly_placeholder", // Replace with your actual monthly price ID
  yearly: "price_yearly_placeholder", // Replace with your actual yearly price ID
```

### Updated Code:
```typescript
const PRICE_IDS = {
  monthly: "price_1SyJVfF2kOU6awRkLbvUGeLl",
  yearly: "price_1SyJcpF2kOU6awRk2uaH9xum",
```

## Next Steps After This Change
1. **Configure Stripe Webhook** in your Stripe Dashboard:
   - Go to **Developers → Webhooks**
   - Add endpoint: `https://enhksxikgvvdohseivpx.supabase.co/functions/v1/stripe-webhook`
   - Select events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

2. **Test the flow** by navigating to `/premium` and attempting a subscription with Stripe test cards
