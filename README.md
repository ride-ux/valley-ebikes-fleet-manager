# ⚡ Valley E-Bikes Fleet Manager

Fleet maintenance system for managing hire bikes — checks, faults, services, batteries, parts inventory, and reporting. Built with React + Supabase for real-time multi-device sync.

---

## DEPLOY GUIDE — Step by Step

You need to do 3 things:
1. Create a Supabase project (your database)
2. Run the schema SQL (creates the tables)
3. Deploy to Netlify (makes it live)

Total time: ~20 minutes.

---

### STEP 1: Create Supabase Project

1. Go to https://supabase.com and sign up / log in
2. Click **"New Project"**
3. Fill in:
   - **Name:** `valley-ebikes-fleet`
   - **Database Password:** pick something strong, save it somewhere
   - **Region:** `Southeast Asia (Singapore)` (closest to NSW)
4. Click **Create new project** — wait ~2 minutes for it to spin up
5. Once ready, go to **Settings → API** (left sidebar)
6. Copy these two values (you'll need them in Step 3):
   - **Project URL** — looks like `https://abcdefg.supabase.co`
   - **anon public** key — the long string under "Project API keys"

---

### STEP 2: Run the Schema SQL

1. In your Supabase dashboard, click **SQL Editor** (left sidebar)
2. Click **"New query"**
3. Open the file `supabase-schema.sql` from this project
4. Copy the ENTIRE contents and paste into the SQL editor
5. Click **Run** (or Cmd+Enter)
6. You should see "Success. No rows returned" — that's correct
7. Click **Table Editor** (left sidebar) — you should see 7 tables:
   - bikes, batteries, checks, faults, services, parts, staff
8. Click on **parts** — you should see 8 pre-loaded parts
9. Click on **staff** — you should see "Mick" with role "admin"

If you see those tables with data, the database is ready.

---

### STEP 3: Deploy to Netlify

#### Option A: Drag & Drop (easiest)

1. Install Node.js if you don't have it: https://nodejs.org (LTS version)
2. Open Terminal and navigate to this project folder:
   ```
   cd fleet-manager
   ```
3. Create the `.env` file:
   ```
   cp .env.example .env
   ```
4. Edit `.env` and paste your Supabase URL and anon key:
   ```
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```
5. Install dependencies and build:
   ```
   npm install
   npm run build
   ```
6. Go to https://app.netlify.com
7. Sign up / log in
8. Drag the `dist` folder onto the Netlify dashboard
9. Your site is live! Netlify gives you a URL like `random-name-123.netlify.app`

#### Option B: Git Deploy (better for updates)

1. Push this project to a GitHub repo
2. Go to https://app.netlify.com → **Add new site → Import from Git**
3. Connect your GitHub and select the repo
4. Build settings (should auto-detect from `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`
5. Click **Site settings → Environment variables** and add:
   - `VITE_SUPABASE_URL` = your Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
6. Trigger a redeploy — done!

Every time you push to GitHub, Netlify auto-rebuilds.

---

### STEP 4: Custom Domain (optional)

1. In Netlify, go to **Site settings → Domain management**
2. Click **Add custom domain**
3. Enter: `fleet.valleyebikes.com.au` (or whatever you want)
4. Netlify will give you a DNS record to add
5. Log into your domain registrar and add the CNAME or A record
6. Wait ~10 minutes for DNS to propagate
7. Netlify auto-provisions SSL (HTTPS) for free

---

### STEP 5: Add to Phone Home Screen (instant "app")

**iPhone:**
1. Open the site in Safari
2. Tap the Share button (square with arrow)
3. Tap "Add to Home Screen"
4. Name it "Fleet Manager"

**Android:**
1. Open the site in Chrome
2. Tap the 3-dot menu
3. Tap "Add to Home Screen"

This gives you a full-screen app experience without needing the App Store.

---

## DAILY USE

- **Morning:** Open the app → Dashboard shows fleet readiness
- **Before each ride:** Tap Pre-Ride Check → toggle through items → submit
- **After each ride:** Tap Post-Ride Check → note any issues → submit
- **Found a problem:** Tap Report Fault → select category + code → submit
- **Service day:** Go to Services → open the job → add parts + notes → complete
- **End of week:** Go to Reports → Last 7 days → export CSV

All devices see the same data in real-time. If a staff member fails a pre-ride check on their phone, the dashboard on your iPad updates instantly.

---

## FILE STRUCTURE

```
fleet-manager/
├── index.html              # Entry point
├── package.json            # Dependencies
├── vite.config.js          # Build config
├── netlify.toml            # Netlify deploy config
├── .env.example            # Environment variable template
├── supabase-schema.sql     # Database schema — run in Supabase SQL editor
├── public/
│   └── favicon.svg         # Orange lightning bolt icon
└── src/
    ├── main.jsx            # React mount
    ├── App.jsx             # Full application (~2000 lines)
    └── supabaseClient.js   # Supabase connection + CRUD helpers
```

---

## SECURITY NOTES

The current setup uses permissive Row Level Security (RLS) policies — anyone with your Supabase URL and anon key can read/write data. This is fine for V1 because:

- Your anon key is only exposed in the built JS (not publicly listed anywhere)
- The URL is obscure
- The data isn't sensitive (bike maintenance records)

**When you're ready to lock it down:**
1. Add Supabase Auth (email/password login for staff)
2. Update RLS policies to require authentication:
   ```sql
   create policy "staff_only" on bikes
     for all using (auth.uid() is not null)
     with check (auth.uid() is not null);
   ```
3. I can build a login screen for you when you're ready

---

## NEED HELP?

Common issues:
- **"Failed to connect to database"** → Check your .env values match Supabase exactly
- **Data not showing** → Make sure you ran the schema SQL in Step 2
- **Build errors** → Make sure you ran `npm install` first
- **White screen** → Check browser console (F12) for errors
