

## Fix: Update AI Builder paywall card price from $50 to $60

### Problem
The paywall card in `AIBetBuilderPage.tsx` line 562 shows "$50/year" but the actual Stripe price and Premium page both use $60/year. This creates a misleading price anchor.

### Change
**File**: `src/pages/AIBetBuilderPage.tsx`, line 562

Change:
```
<p className="text-lg font-bold text-primary">$50/year</p>
```
To:
```
<p className="text-lg font-bold text-primary">$60/year</p>
```

Single-line fix. No other files affected.

### Technical Details
- Only one occurrence of "$50" exists in the codebase (this line)
- The Premium page already shows $60/yr with Stripe price ID `price_1SyJcpF2kOU6awRk2uaH9xum`
- The "Early access pricing" subtitle on line 563 remains accurate

