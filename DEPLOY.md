# Central Studio — Public Deployment Guide

Three services, three platforms. Deploy them in this order:

```
1. Railway  → API server + PostgreSQL database
2. Vercel   → Admin dashboard (static SPA)
3. EAS      → Mobile app APK/IPA
```

Once you have the Railway URL from step 1, you paste it into steps 2 and 3.

---

## Prerequisites

| Tool | Install |
|------|---------|
| Git & GitHub account | https://github.com |
| Railway account | https://railway.app |
| Vercel account | https://vercel.com |
| Expo account | https://expo.dev |
| EAS CLI | `npm install -g eas-cli` |
| Node 20+ | https://nodejs.org |
| pnpm 9+ | `npm install -g pnpm` |

Push the repo to GitHub if you haven't already:

```bash
cd Central-Studio-System-main
git init
git remote add origin https://github.com/YOUR_USERNAME/central-studio.git
git add .
git commit -m "Initial commit"
git push -u origin main
```

---

## Part 1 — Deploy the API server on Railway

### 1.1 — Create a new Railway project

1. Go to https://railway.app → **New Project**
2. Choose **Deploy from GitHub repo** → select your repo
3. Railway detects `railway.toml` automatically — no extra config needed

### 1.2 — Add a PostgreSQL database

Inside your Railway project:

1. Click **+ New** → **Database** → **Add PostgreSQL**
2. Railway creates a Postgres instance and adds `DATABASE_URL` to your service's env automatically

### 1.3 — Set environment variables

In Railway → your service → **Variables**, add:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `API_SECRET_KEY` | A strong random string — generate with the command below |
| `ALLOWED_ORIGINS` | Leave blank for now; you'll fill this in after Vercel is set up |

Generate the key locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output — you'll use the same value in Vercel and EAS.

### 1.4 — Deploy

Click **Deploy** (or push to main — Railway auto-deploys on every push).

Watch the build logs. You should see:

```
✓ pnpm install
✓ pnpm --filter @workspace/api-server run build
✓ Database migrations up to date
✓ Server listening on port ...
```

### 1.5 — Verify

Railway gives your service a public URL like `https://central-studio-api-production.up.railway.app`.

```bash
curl https://YOUR-RAILWAY-URL.up.railway.app/api/healthz
# → {"status":"ok"}
```

Save this URL — you need it for Part 2 and Part 3.

### 1.6 — Update ALLOWED_ORIGINS

After Part 2 is done (you'll have a Vercel URL), come back and add:

```
ALLOWED_ORIGINS=https://your-admin.vercel.app
```

Railway will redeploy automatically.

---

## Part 2 — Deploy the Admin dashboard on Vercel

### 2.1 — Import project

1. Go to https://vercel.com → **Add New Project**
2. Import your GitHub repo
3. Vercel detects the `vercel.json` in `artifacts/admin/`

> **Root Directory:** Set this to `artifacts/admin` in the Vercel project settings.

### 2.2 — Set environment variables

In Vercel → Project → **Settings → Environment Variables**:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | Your Railway URL, e.g. `https://central-studio-api-production.up.railway.app` |
| `VITE_API_KEY` | The same `API_SECRET_KEY` value you set on Railway |

### 2.3 — Deploy

Click **Deploy**. Vercel runs:

```
cd ../.. && pnpm install --frozen-lockfile --prod=false && pnpm --filter @workspace/admin run build
```

Output is served from `artifacts/admin/dist/public/`.

### 2.4 — Verify

Open your Vercel URL in a browser. The admin dashboard should load.

Go to **Classes** → click **New Class** → save. Then check:

```bash
curl https://YOUR-RAILWAY-URL.up.railway.app/api/classes \
  -H "X-Api-Key: YOUR_API_SECRET_KEY"
# → [{"id":1,...}]
```

### 2.5 — Update ALLOWED_ORIGINS on Railway

Now that you have the Vercel URL, go back to Railway → Variables and set:

```
ALLOWED_ORIGINS=https://your-admin.vercel.app
```

---

## Part 3 — Build the Mobile app with EAS

### 3.1 — Configure app identifiers

Your `app.json` already has:

```json
"ios": { "bundleIdentifier": "com.centralstudio.app" },
"android": { "package": "com.centralstudio.app" }
```

Change these to match your own domain if you plan to publish to the stores
(e.g. `com.yourname.centralstudio`). The value must be unique on the App Store
and Google Play.

### 3.2 — Log in to Expo

```bash
eas login
```

### 3.3 — Link the project to your Expo account

```bash
cd artifacts/central
eas init --id YOUR_EXPO_PROJECT_ID
```

Or let EAS create a new project:

```bash
eas init
```

### 3.4 — Set EAS secrets (env vars baked into the build)

```bash
# Public API URL (visible in the bundle — that's fine)
eas secret:create --scope project --name EXPO_PUBLIC_API_URL \
  --value "https://YOUR-RAILWAY-URL.up.railway.app"

# API key (semi-public — same key used by the admin dashboard)
eas secret:create --scope project --name EXPO_PUBLIC_API_KEY \
  --value "YOUR_API_SECRET_KEY"
```

### 3.5 — Build the APK (Android — sideload or distribute directly)

```bash
cd artifacts/central
eas build --profile preview --platform android
```

EAS builds in the cloud. When it finishes (~10 min) you get a download link
for the `.apk` file. Install it on any Android device:

```bash
# Transfer to device and install, or download directly on the device
adb install central-preview.apk
```

### 3.6 — Build the IPA (iOS — internal distribution)

```bash
eas build --profile preview --platform ios
```

This requires an Apple Developer account ($99/yr). The IPA is distributed
via TestFlight or via an Ad Hoc provisioning profile.

If you only need Android for now, skip iOS entirely.

### 3.7 — Verify

Open the installed app → go to **Classes**. The list should load from your
live Railway API. Book a class → check the Railway-backed admin dashboard
to confirm the booking appears.

---

## Environment variable summary

| Variable | Service | Where to set |
|----------|---------|-------------|
| `NODE_ENV=production` | API | Railway → Variables |
| `DATABASE_URL` | API | Railway (auto-set by Postgres plugin) |
| `API_SECRET_KEY` | API | Railway → Variables |
| `ALLOWED_ORIGINS` | API | Railway → Variables |
| `VITE_API_URL` | Admin | Vercel → Env vars |
| `VITE_API_KEY` | Admin | Vercel → Env vars |
| `EXPO_PUBLIC_API_URL` | Mobile | EAS secrets |
| `EXPO_PUBLIC_API_KEY` | Mobile | EAS secrets |

`API_SECRET_KEY`, `VITE_API_KEY`, and `EXPO_PUBLIC_API_KEY` must all be the
same value.

---

## Full end-to-end verification

1. Admin dashboard → create 1 instructor + 1 class
2. Mobile app → open **Classes** tab → class appears
3. Mobile app → tap class → **Book This Class** → complete flow
4. Admin dashboard → **Bookings** → booking appears in the table
5. `curl https://YOUR-RAILWAY-URL/api/bookings -H "X-Api-Key: KEY"` → booking in JSON

---

## Redeploying after code changes

| What changed | What to do |
|---|---|
| API server code | `git push` — Railway auto-redeploys |
| Admin dashboard code | `git push` — Vercel auto-redeploys |
| Mobile app code | `eas build --profile preview --platform android` again |
| Database schema | Run `pnpm --filter @workspace/db run generate` locally, commit the new migration file, then `git push` — migrations run automatically on Railway startup |

---

## Custom domains

- **Railway:** Project → your service → **Settings → Networking → Custom Domain**
- **Vercel:** Project → **Settings → Domains** → add your domain
- After adding a custom domain to Vercel, update `ALLOWED_ORIGINS` on Railway to use that domain instead of the `.vercel.app` URL.
