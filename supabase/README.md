# Supabase persistence

Run `supabase/schema.sql` in the connected Supabase project's SQL editor.

The server-side API expects:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Keep the service-role key server-side only. Never expose it through a `NEXT_PUBLIC_` variable.

The browser-storage MVP remains the fallback until database connectivity is verified.
