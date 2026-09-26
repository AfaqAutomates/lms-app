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


## What's next
Matches the phase plan already agreed:
- Running hours (history, anomaly detection, replacement-due calculations)
- Oil analysis (manual entry, configurable limits, trends)
- Procurement + inventory/stock
- Dashboard + monthly report export (PDF/Excel)
- SAP Excel import framework

Each phase is just more tables in `db/schema.sql` and more tab logic in
`public/js/app.js` — same deploy, no rebuild needed for the hosting part.
