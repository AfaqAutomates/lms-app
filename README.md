# Industrial Lubrication Management & Reliability System

A real, standalone web app — independent of Claude — built on entirely free
services. No servers to maintain, no monthly bill at plant scale.

## Stack (all free tier)
- **Database + Auth + security:** [Supabase](https://supabase.com) (free tier: 500MB database, unlimited API requests, built-in login, and — critically — Postgres Row Level Security, which enforces who can edit vs. view *inside the database itself*, not just in the page you're looking at)
- **Hosting:** [Netlify](https://netlify.com) or [Vercel](https://vercel.com) (free tier, static sites) — or literally just open `public/index.html` on a shared drive for a first test
- **Code:** plain HTML/CSS/JS, no build step, no npm install required

## Setup — about 15 minutes

### 1. Create your free Supabase project
1. Go to supabase.com → sign up (free) → "New project".
2. Pick any name/region, set a database password (save it somewhere).
3. Wait ~2 minutes for it to provision.

### 2. Create the database tables
1. In your Supabase project, open **SQL Editor** → **New query**.
2. Paste the entire contents of `db/schema.sql` (in this project) and click **Run**.
3. This creates every table (equipment, components, lubrication points,
   lubricants, activities, roles) plus the security rules — all in one go.

### 3. Connect the app to your project
1. In Supabase: **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
3. Open `public/js/config.js` in this project and paste them in:
   ```js
   window.LMS_CONFIG = {
     SUPABASE_URL: "https://xxxxxxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGc...",
   };
   ```
   (These two values are meant to be public — they go in the browser. Real
   security comes from the RLS policies in `db/schema.sql`, not from hiding
   this key.)

### 4. Turn on email sign-up (usually on by default)
Supabase → **Authentication → Providers** → make sure **Email** is enabled.
For a first test you can also disable "Confirm email" under
**Authentication → Settings** so you don't need a working inbox to try it out
— just remember to turn it back on before real plant use.

### 5. Deploy it — pick one
- **Easiest:** go to app.netlify.com/drop and drag the whole `public` folder
  onto the page. You get a live URL in seconds. Free forever for this size
  of app.
- **Also easy:** push this folder to a GitHub repo, then "New site from Git"
  on Netlify or "New Project" on Vercel, pointing at the `public` folder.
- **Zero deployment:** just double-click `public/index.html` to open it
  locally, or put the `public` folder on a shared network drive at the
  plant — works the same, just without a public URL.

### 6. First login
1. Open your deployed URL → **Sign up** with your email/password.
2. The **first person ever to sign up automatically becomes Administrator**
   (see the schema's `handle_new_user` trigger) — so that's you.
3. Start entering Equipment, Components, Lubrication Points, Lubricants,
   and recording Activities.

### 7. Install it as a mobile app (optional but recommended)
The app is a PWA (Progressive Web App) — it can be "installed" like a real
app, with its own icon, no browser bar, full-screen:
- **Android (Chrome):** open the deployed URL → tap the ⋮ menu →
  **"Add to Home screen" / "Install app"**.
- **iPhone (Safari):** open the deployed URL → tap the Share icon →
  **"Add to Home Screen"**.

No app store, no APK, no review process — same free deploy, just installed
like an app. It also caches the page shell so it still *opens* without
signal (recording new data still needs a live connection to reach Supabase).

## Assigning roles to your team
Anyone who signs up starts with **no functional role** (view-only, per spec
§53) until an Administrator assigns one. Right now, the in-app "Assign a
role" box can't look someone up by email directly — Supabase intentionally
keeps `auth.users` (which holds emails) off-limits to the browser, for
privacy. Two ways to assign roles for now:

**Quick way (fine for a small team):** in Supabase, go to
**Authentication → Users**, find the person, copy their **User UID**. Then
go to **Table Editor → user_roles → Insert row**, paste that UID into
`user_id`, and pick their `role`.

**Proper way (worth doing once your team grows):** create a small Supabase
Edge Function that looks up a user by email using the service-role key
(kept server-side, never in the browser) and returns their UID to the
Administrator's screen. Ask me and I'll write that function for you — it's
about 15 lines of code, one extra free Supabase feature (Edge Functions
have a generous free tier too).

## What's built so far
The app is now styled as **LubriTrack** — a dark navy sidebar, KPI dashboard,
compact status-badge tables, and a consistent modal-based add/edit pattern
across every module, matching the design brief. On phones the sidebar
becomes a slide-out drawer (tap the menu icon).

- **Dashboard** — real KPI cards (total lubrication points, activities in
  the last 30 days, total assets), recent activity feed, team roles. The
  "Due Soon / Overdue" KPI is intentionally shown as "Coming in Phase 3" —
  it needs Running Hours tracking to be real, so it's not faked.
- **Assets** (Equipment master) — add/edit/delete via modal, lubrication
  point count per asset, status badges, gated to Engineer/Administrator
- **Lubrication Points** — with a Components sub-tab, same pattern
- **Work Orders** — currently shows recorded lubrication *activities*
  (completed work), open to every signed-in user to record; edit/delete
  restricted to Engineer/Administrator. True open/in-progress/scheduled
  work orders are a real feature addition for a later phase.
- **Inventory** — Lubricants master data (Greases/Filters/Other Supplies
  sub-tabs are placeholders until full inventory/stock tracking, Phase 5)
- **Audit History** — real, built from every table's created/updated
  timestamps — not a placeholder
- **Settings** — role assignment, enforced by the database (Postgres RLS)
- **Oil Analysis, Alerts, Reports** — placeholder pages in the same design
  language, clearly labeled with which phase brings them to life


## Stage A update — admin-only accounts, feature toggles

This adds real Admin Portal foundations: no self-signup, a seeded
Administrator account, and per-user feature toggles (replacing the old
role system). Three things to do, once:

### A1. Run the migration
In Supabase SQL Editor, run `db/migrations/002_admin_auth_and_features.sql`
(after the original `db/schema.sql`, which you've already run). This:
- adds `is_admin` + `email` to profiles
- creates `features` / `user_features` tables and the permission functions
- rewrites the masters' security rules to check per-user feature toggles
- seeds the admin account: **admin@lubrication.com / Admin@123**

**Change that password immediately after your first login** — it sits in
this SQL file in plain text (that's what was asked for; just don't leave
it that way).

### A2. Turn off self-signup in Supabase
Dashboard → **Authentication → Sign In / Providers** (or **Authentication →
Settings**, layout varies) → find **"Allow new users to sign up"** → turn
it **off**. This is a dashboard setting, not something the SQL/code can
control.

### A3. Deploy the admin-create-user Edge Function
This is the one piece that needs elevated privileges (creating a login for
someone), so it runs as a small serverless function rather than in the
browser. Easiest path — no command line needed:
1. Supabase Dashboard → **Edge Functions** → **"Deploy a new function"**.
2. Name it exactly `admin-create-user`.
3. Paste in the contents of `supabase/functions/admin-create-user/index.ts`.
4. Deploy. Supabase automatically provides the service-role key as an
   environment secret inside the function — you don't paste it anywhere.

(If you'd rather use the CLI: `supabase functions deploy admin-create-user`
after `supabase login` and `supabase link`.)

### What changes for your team
- Log in as `admin@lubrication.com` / `Admin@123` first.
- Go to **Settings** → create real user accounts (no one else can sign
  themselves up).
- For each user, click **"Manage access"** and toggle on whatever they
  should be able to do — everyone starts with nothing enabled.
- Everyone (including the admin) can change their own password anytime via
  **"Change password"** in the top bar.

## What's next
Matches the phase plan already agreed:
- Running hours (history, anomaly detection, replacement-due calculations)
- Oil analysis (manual entry, configurable limits, trends)
- Procurement + inventory/stock
- Dashboard + monthly report export (PDF/Excel)
- SAP Excel import framework

Each phase is just more tables in `db/schema.sql` and more tab logic in
`public/js/app.js` — same deploy, no rebuild needed for the hosting part.


## Master-data form updates
- Equipment: removed Manufacturer, Model, and Serial Number from the form; Status and Lubrication Criticality are controlled dropdowns.
- Components: SAP Equipment # is a searchable selection from existing equipment; Description was removed; Component Type remembers previous values; Criticality and Status are dropdowns.
- Lubrication Points: SAP Equipment # and Component Name are restricted to existing master data; Point Name remembers previous values; Lubrication Type, Lubricant, Criticality, and Status use controlled selections. A permitted user can add a lubricant from the lubrication-point form.
- Run `db/migrations/003_master_form_controls.sql` against an existing Supabase database before using the updated lubrication-point form.
