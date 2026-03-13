

## Better Error Handling for AI Bet Builder

### Problem
The hook's catch block shows a generic error message for all failures, including 402 (credits exhausted) from the Lovable AI gateway. The `supabase.functions.invoke` wraps non-2xx responses into a generic `FunctionsHttpError`.

### Plan

**File: `src/hooks/useAIBetBuilder.ts`** — Enhance the error handling in `buildSlips`:

1. **Add 402 detection** in the `fnError` block (alongside existing 429 check):
   - Check for `"402"` or `"non-2xx"` in the error message
   - Set a user-friendly error: "AI service credits exhausted. Please try again later or check your plan."
   - Show a descriptive toast

2. **Add no-data detection** for when scoring data is missing:
   - Check for `"no candidates"` or similar in the error
   - Show: "Today's prop data isn't ready yet. Try again after games are loaded."

3. **Improve the generic catch** to show more actionable messages:
   - Network errors → "Connection failed. Check your internet and try again."
   - Default → "Something went wrong generating your slip. Please try again."

4. **Add a `retryable` boolean** to state so the UI can show a retry button.

**File: `src/pages/AIBetBuilderPage.tsx`** — Update error display:

5. **Show contextual error UI** with an Alert component instead of just toast:
   - Different icons/colors for credits vs network vs generic errors
   - Add a "Try Again" button next to the error message

This is a small, focused change across 2 files.

