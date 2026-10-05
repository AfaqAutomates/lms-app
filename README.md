# LubriTrack — Industrial Lubrication Management & Reliability System

## Stage B.1 Complete — Forms, Running Hours, Hierarchical Data Entry

**Live Demo:** https://lms-app-coral-seven.vercel.app (update URL after deploying)  
**GitHub:** https://github.com/AfaqAutomates/lms-app (update repo name as needed)

### What's New in Stage B.1

1. **Redesigned Forms** — Equipment, Component, and Lubrication Point modals with:
   - Typeahead autocomplete (SAP Equipment #, Component names, Point names)
   - Dropdown selects (Status: Active/Inactive, Criticality: High/Medium/Low)
   - Intelligent filtering (e.g., Component dropdown filtered by Equipment)

2. **Running Hours Tracker** — Manage 36 plant resources (KILN01, COALM01, RM01, etc.):
   - Update running hours for each resource
   - Auto-cascade updates to all equipment linked to that resource

3. **Equipment-Resource Linking** — Each equipment can link to one or more resources

4. **Lubricant Master Data** — Reusable lubricant records with inline "Add Lubricant" button

5. **Lubrication Types** — Dropdown: Oil, Grease, Automatic Lubricator, Circulating Oil System, Other

### Tech Stack

- **Frontend:** Plain HTML/CSS/JavaScript, PWA (no build step required)
- **Backend:** Supabase (PostgreSQL) for data, RLS for access control
- **Auth:** Supabase Auth (no self-signup, admin-only user creation)
- **Hosting:** Vercel (auto-deploy from GitHub)

### One-Time Setup (Read This Carefully)

#### Step 1: Update Configuration

1. Extract the zip
2. Open `public/js/config.js`
3. Paste your **actual** Supabase URL and anonymous key:
   ```javascript
   window.LMS_CONFIG = {
     SUPABASE_URL: 'https://your-project.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbG...'
   };
   ```
4. Save and commit to GitHub

**Important:** `config.js` resets when you re-zip the project. Always update it before pushing to GitHub.

#### Step 2: Database Migrations

Run these SQL migrations in order via Supabase → SQL Editor:

1. **`db/schema.sql`** — Core tables (equipment, components, lubrication_points, etc.)
2. **`db/migrations/002_admin_auth_and_features.sql`** — Admin auth, feature toggles, seed admin
3. **`db/migrations/003_stage_b1_forms.sql`** — New B.1 tables (resources, lubricants_master, etc.)

Each is idempotent — safe to re-run if you get "table already exists" errors.

**Seed Admin Account:**
- Email: `admin@lubrication.com`
- Password: `Admin@123`
- **Change this password immediately after first login.**

#### Step 3: GitHub & Vercel

1. Create a GitHub repo: `https://github.com/your-org/lms-app`
2. Push all files from this zip
3. Connect Vercel to GitHub → auto-deploys on every push
4. Once deployed, update the demo link at the top of this README

#### Step 4: Test

Sign in as `admin@lubrication.com` and:

1. Go to **Settings** → create a test user
2. Enable "Edit Assets" feature for that user
3. Test **Assets** tab → Add Asset
4. Test **Lubrication Points** tab → Add Lubrication Point
5. Test **Running Hours** tab → update KILN01 running hours
6. Verify all dropdowns and typeahead work

---

## Usage Guide

### Dashboard
- Overview of total equipment, points, resources, activities
- Your access level displayed

### Assets (Equipment)
- Add/edit/delete equipment
- Set Status (Active/Inactive) and Lubrication Criticality (High/Medium/Low)
- Typeahead search by SAP Equipment #

### Lubrication Points
- **Points tab:** Add lubrication points with typeahead for equipment and component
- **Components tab:** Add components with typeahead for equipment and component type
- Link to lubricant master, set lubrication type (Oil/Grease/etc.)

### Running Hours (NEW)
- Select a resource (KILN01, COALM01, etc.)
- Enter new running hours
- Click "Update" → automatically updates all equipment linked to that resource

### Work Orders
- View recorded activities (created in other modules)

### Inventory
- View all lubricants in the master database

### Audit History
- View all changes across the system (created/updated records)

### Settings (Admin Only)
- Create users and assign feature access per-user
- Users cannot access features unless admin enables them

---

## Feature Flags (Configurable Per-User)

| Feature Key | Module | Label |
|---|---|---|
| `assets.edit` | Assets | Edit Assets |
| `points.edit` | Lubrication Points | Edit Lubrication Points |
| `workorders.record` | Work Orders | Record Activities |
| `workorders.edit` | Work Orders | Edit Activities |
| `inventory.edit` | Inventory | Edit Inventory |

---

## File Structure

```
lms-app/
├── db/
│   ├── schema.sql                   — Core schema (run first)
│   └── migrations/
│       ├── 002_admin_auth_and_features.sql
│       └── 003_stage_b1_forms.sql   (running hours, resources, lubricants_master)
├── public/
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js                   (complete, no patching)
│   │   ├── config.js                (INSERT YOUR SUPABASE CREDENTIALS)
│   │   └── icons.js
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
├── supabase/
│   └── functions/
│       └── admin-create-user/
│           └── index.ts             (Edge Function for user creation)
└── README.md
```

---

## Key Decisions (v2 Architecture)

✅ **No self-signup** — Admin creates all users  
✅ **Feature toggles** — Per-user access control (not roles)  
✅ **Config-driven** — All admin-editable via UI (no hardcoded values)  
✅ **Portability** — Standard PostgreSQL, no vendor lock-in  
✅ **PWA** — Offline-ready (service worker included)  

---

## Troubleshooting

**Blank page?**
- Check browser console (F12)
- Verify `config.js` has your real Supabase credentials
- Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

**Forms not showing?**
- Make sure migration 003 ran successfully
- Check Supabase SQL Editor history for errors

**"Equipment not appearing" in typeahead?**
- Add equipment first (Assets tab), then components use that list
- Refresh the form by clicking away and back

**"Resources missing" from Running Hours?**
- Migration 003 seeds 36 resources automatically
- If missing, re-run migration 003

---

## What's Next (Phase B.2)

- Normalize plant hierarchy → Plant/Area/System as real tables
- Equipment belongs to Area → belongs to Plant
- Running hours and due-date calculations become location-aware
- Filter dashboard by plant/area

---

## Support

For issues or questions:
1. Check this README first
2. Review the deployment guide in the zip root
3. Check browser console for JavaScript errors
4. Review Supabase SQL Editor history for migration errors

Good luck! 🚀
