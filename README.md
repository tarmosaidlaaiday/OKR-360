# Cadence — OKR Workspace

A focused OKR tool built with React, TypeScript, Vite, and Supabase.

## Local Development

```bash
cp .env.example .env.local
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

npm install
npm run dev       # http://localhost:5173
```

Run `supabase/schema.sql` in the Supabase SQL editor to create tables, RLS policies, and seed data. Then apply migrations in `supabase/migrations/` in order.

## Database Migrations

All schema changes must be applied via the Supabase SQL editor **OR** via `npx supabase db push` after verifying the CLI can connect. Never assume `db push` worked without confirming with `migration list`.

### Applying migrations

```bash
# Check what is pending (safe, no changes applied):
npx supabase db push --dry-run

# Apply pending migrations:
npx supabase db push

# Verify sync state (local vs remote must match):
npx supabase migration list

# Run a SQL file directly against the remote DB:
npx supabase db query --linked -f supabase/migrations/your_file.sql
```

### Installing the Supabase CLI (if not available as a bare command)

The project uses `npx supabase` which pulls the CLI from the local `node_modules`. If you need the bare `supabase` command:

```bash
# If brew is available:
brew install supabase/tap/supabase

# Otherwise (no sudo required):
npm install -g supabase --prefix ~/.local
# Then add ~/.local/bin to your PATH
```

After installing, link to the project:
```bash
supabase login                                    # opens browser for auth
supabase link --project-ref githzeldiwxkmruhaver  # one-time per machine
supabase db push --dry-run                        # verify connection
```

### Migration naming convention

All migration files must use the format `YYYYMMDDNNNNNN_name.sql` (e.g. `20260530000001_five_features.sql`). Mixed formats (`YYYYMMDD_NNN_name`) cause version ordering conflicts in Supabase's `schema_migrations` table and break `db push`.

## Deploy to Netlify

1. Push the repo to GitHub.
2. In Netlify → **Add new site → Import an existing project**.
3. Set the following environment variables in **Site configuration → Environment variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Netlify picks up `netlify.toml` automatically — build command and publish directory are pre-configured.

The `[[redirects]]` rule in `netlify.toml` routes all paths to `index.html` so React Router handles client-side navigation.

## Supabase Edge Functions

Deploy the `admin-create-user` function after enabling edge functions in your Supabase project:

```bash
npx supabase functions deploy admin-create-user
```

This function requires the `SUPABASE_SERVICE_ROLE_KEY` secret, which Supabase injects automatically in the edge function runtime.
