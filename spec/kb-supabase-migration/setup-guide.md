# Supabase Setup — How-To (your ~5-minute part)

This is the manual, dashboard-only half of the Neon → Supabase migration (`spec.md`). It provisions the database and wires it to Vercel so the KB store + daily cron actually run. The code changes are handled separately.

**What you're doing:** creating a Supabase Postgres DB, grabbing its **transaction-pooler** connection string, putting it in Vercel as `DATABASE_URL`, making sure `CRON_SECRET` exists, and redeploying.

> ⚠️ **Security first.** The connection string contains your database password. **Don't paste a production connection string into chat.** Best path: set it in Vercel yourself (Step 3B) and just tell me "done" — I can verify everything from the live endpoint without ever seeing the secret. Only share a connection string with me if it's a throwaway you'll rotate afterward.

---

## Step 1 — Create a Supabase project

1. Go to **https://supabase.com/dashboard** → sign in → **New project**.
2. Fill in:
   - **Name:** e.g. `ai-tutor-kb`
   - **Database Password:** click **Generate**, then **save it** (you need it in Step 2). This is the `postgres` role password.
   - **Region:** pick the one closest to your Vercel function region. Vercel Hobby defaults to **US East (iad1 / Washington DC)** → choose Supabase **East US (North Virginia)**. Same-region keeps DB latency low.
3. **Create new project** and wait ~2 min for it to provision.

## Step 2 — Copy the TRANSACTION pooler connection string (port 6543)

This is the one detail that matters most — the direct connection (5432) is IPv6-only and **won't work from Vercel functions**.

1. Top of the project → click **Connect** (or **Project Settings → Database → Connection string**).
2. Choose the **Transaction pooler** option (labeled "Ideal for serverless / edge", **port 6543**, host ends in `...pooler.supabase.com`). *Not* "Direct connection", *not* "Session pooler".
3. Copy the string. It looks like:
   ```
   postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
4. Replace `[YOUR-PASSWORD]` with the password from Step 1.
5. Append SSL if it isn't already there:
   ```
   ...pooler.supabase.com:6543/postgres?sslmode=require
   ```

> The code sets `prepare: false` in the client (required for transaction-mode pooling), so you do **not** need to add `?pgbouncer=true`. `sslmode=require` is enough.

## Step 3 — Put it in Vercel as `DATABASE_URL`

Pick **A** (integration, less fiddly) **or** **B** (manual).

### 3A — Supabase Vercel integration (recommended)
1. **https://vercel.com/marketplace/supabase** → **Add integration** → authorize → select your **ai-tutor-elevenlabs** project.
2. Link it to your Supabase project. It injects Supabase env vars automatically.
3. **Variable name — no action needed.** The integration provisions `POSTGRES_URL` (the pooled, 6543 connection). The app reads `DATABASE_URL || POSTGRES_URL`, so it picks that up automatically. (You can still add an explicit `DATABASE_URL` if you prefer — it takes precedence.)

### 3B — Manual (full control, safest for secrets)
1. Vercel → your project → **Settings → Environment Variables → Add New**.
2. **Key:** `DATABASE_URL` · **Value:** the transaction-pooler string from Step 2.
3. **Environments:** tick **Production** and **Preview** (leave Development unticked unless you want it locally — locally you'd put it in `.env.local`, which is gitignored).
4. **Save.**

## Step 4 — Confirm `CRON_SECRET` (the cron writer needs it)

The daily cron hits `/api/scrape/refresh`, which rejects any request without `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends that header automatically **only if `CRON_SECRET` is set**.

1. Vercel → **Settings → Environment Variables** → look for **`CRON_SECRET`**.
2. If missing, generate one and add it (Production):
   ```bash
   openssl rand -hex 32
   ```
   Key: `CRON_SECRET` · Value: the generated string · Environment: **Production**.

## Step 5 — Redeploy (env changes need a fresh deploy)

Environment variables only take effect on **new** deployments.

- Vercel → **Deployments** → latest → **⋯ → Redeploy**, **or** push any commit to `main`.
- No manual schema step needed: on first DB access the app runs `CREATE TABLE IF NOT EXISTS` for `articles` + `kb_meta` automatically, then self-heals (scrapes once) to populate.

---

## Verify it worked

**A. Kick off the first write (optional — the first visitor triggers it anyway):**
```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://ai-tutor-elevenlabs.vercel.app/api/scrape/refresh
```
→ expect HTTP 200 + a `status` JSON. Then open Supabase → **Table Editor** → the `articles` table should have ~24 rows.

**B. Confirm persistence (the real proof):** hit the status endpoint twice, a minute apart:
```bash
curl -s https://ai-tutor-elevenlabs.vercel.app/api/scrape | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])"
```
- ✅ **Working:** `lastSuccessfulFetch` stays the **same** across calls while `ageMs` **grows** — i.e. it's reading stored rows, not re-scraping.
- ❌ **Still broken:** `ageMs` is `0` every time and `lastSuccessfulFetch` jumps to "now" on each call — that means it's still live-scraping (usually `DATABASE_URL` not applied → did you redeploy? is it the 6543 pooler host?).

**C. Cold-start latency:** a first hit to `/api/scrape` after idle should return in **< 2s** (was ~30s).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Timeout / `ENETUNREACH` in function logs | Used the **direct** (5432) connection — IPv6-only | Switch `DATABASE_URL` to the **6543 transaction pooler** host |
| `prepared statement "s0" already exists` | Transaction pooler without `prepare:false` | Code sets `prepare:false`; make sure you're on the migrated build (redeploy) |
| `password authentication failed` | `[YOUR-PASSWORD]` left as placeholder, or wrong password | Reset the DB password in Supabase → Settings → Database, update `DATABASE_URL` |
| `ageMs` still `0` each call | Env not applied, or wrong host | Redeploy; confirm `DATABASE_URL` is on **Production** and is the 6543 pooler URL |
| Cron never refreshes | `CRON_SECRET` missing / mismatched | Set `CRON_SECRET` in Vercel, redeploy |

---

**When you're done:** just say **"done"** (and, if you're on Vercel Pro and want the cron hourly instead of daily, mention it). I'll finish the code side, run the quality gate, and verify persistence against the live deployment.
