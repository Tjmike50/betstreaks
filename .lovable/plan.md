- Edge Function: Forward Events to External Supabase Project
- Overview
- Create a new Edge Function (`forward-event`) that receives event data from BetStreaks and POSTs it to an `analytics_events` table in a completely separate Supabase project. The external project's URL and service role key are stored as secrets — never exposed to the client.
- Steps
  1. **Add two secrets** to the BetStreaks Supabase project:
- `EXTERNAL_SUPABASE_URL` — the external project's URL
- `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` — the external project's service role key
  1. **Create Edge Function** `supabase/functions/forward-event/index.ts`:
- Accepts POST with JSON body: `{ event_name, user_id?, metadata? }`
- Validates input with Zod
- Reads the two secrets from `Deno.env`
- Creates a Supabase client pointing at the **external** project
- Inserts the row into the external `analytics_events` table
- Returns `{ success: true }` or an error
- **Deploy and test** the function with a sample payload
- **Optionally update the client-side `analytics.ts**` to also (or instead) call this edge function, so BetStreaks app events flow to the external project automatically
- Technical Detail
- Client (or Make/Zapier)
  │
  ▼
forward-event Edge Function (BetStreaks project)
  │  reads EXTERNAL_SUPABASE_URL + EXTERNAL_SUPABASE_SERVICE_ROLE_KEY
  ▼
External Supabase REST API → analytics_events table
- The edge function acts as a secure proxy — the external service role key never leaves the server.