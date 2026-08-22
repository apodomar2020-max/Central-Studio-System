# Central Studio — How to Run Everything Locally

This guide gets all three services running on your machine so you can see the system
end-to-end: API server ↔ Admin dashboard ↔ Mobile app.

---

## Prerequisites

Install these once if you don't have them:

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20 or 22 | https://nodejs.org |
| pnpm | 9+ | `npm install -g pnpm` |
| PostgreSQL | 15 or 16 | https://www.postgresql.org/download/ |
| Expo Go (phone) | latest | App Store / Google Play |
| Xcode (iOS sim) | 15+ | Mac App Store — optional |
| Android Studio | latest | optional |

---

## Step 1 — Create the database

```bash
# Open psql as the postgres superuser
psql -U postgres

# Inside psql:
CREATE DATABASE centralstudio;
CREATE USER centralstudio_user WITH PASSWORD 'changeme';
GRANT ALL PRIVILEGES ON DATABASE centralstudio TO centralstudio_user;
\q
```

Your connection string will be:
```
postgresql://centralstudio_user:changeme@localhost:5432/centralstudio
```

---

## Step 2 — Install all dependencies

```bash
cd Central-Studio-System-main
pnpm install
```

---

## Step 3 — Generate the first database migration

This converts the Drizzle schema into SQL files that are safe to review and commit.

```bash
DATABASE_URL="postgresql://centralstudio_user:changeme@localhost:5432/centralstudio" \
  pnpm --filter @workspace/db run generate
```

You'll see new files in `lib/db/migrations/`. Commit them to git.

---

## Step 4 — Create environment files

> **Use a LOCAL database locally.** Never put Railway's `DATABASE_PUBLIC_URL`
> (host ending in `proxy.rlwy.net`) in your local `.env` — that is the
> **production** database. A safety guard in `@workspace/db` refuses to start
> the API, run migrations, or open Drizzle Studio against a Railway host from
> a local machine. For a deliberate emergency operation against the remote DB
> (e.g. a one-off manual migration), set `ALLOW_REMOTE_DATABASE_LOCAL=true`
> for that single command — it is dangerous and every query hits production.

### API server — `artifacts/api-server/.env`
```
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://centralstudio_user:changeme@localhost:5432/centralstudio

# Leave blank in dev (all origins allowed)
ALLOWED_ORIGINS=
```

There is no shared API secret to configure. Trust model: public/auth routes
need no credential; student routes require a student JWT (issued at
login/OTP/social auth); admin routes require an admin JWT plus RBAC. Each is
verified independently per-request.

### Admin dashboard — `artifacts/admin/.env.local`
```
# In dev, Vite proxies /api → localhost:3000, so no VITE_API_URL needed
```

### Mobile app — `artifacts/central/.env.local`
```
# For iOS simulator: localhost works fine
EXPO_PUBLIC_API_URL=http://localhost:3000

# For Android emulator: use 10.0.2.2 instead of localhost
# EXPO_PUBLIC_API_URL=http://10.0.2.2:3000

# For a physical device: use your Mac's LAN IP (find with: ifconfig | grep "inet ")
# EXPO_PUBLIC_API_URL=http://192.168.1.x:3000
```

> **Note:** `EXPO_PUBLIC_*` variables are bundled into the app at build time.
> After changing them, restart the Expo dev server.

---

## Step 5 — Run the API server

```bash
cd artifacts/api-server
cp .env.example .env   # or create .env manually from Step 4
pnpm run dev
```

The server starts on **http://localhost:3000**.

> **Migrations:** the API server does **not** apply migrations at startup.
> `pnpm run dev` applies them for you (it runs `dist/migrate.mjs` between
> build and start). If you start the server another way (e.g. `pnpm run start`),
> apply migrations first:
>
> ```bash
> pnpm run migrate                                     # from artifacts/api-server
> # or, from the repo root:
> DATABASE_URL="..." pnpm --filter @workspace/db run migrate
> ```

Verify it's alive:
```bash
curl http://localhost:3000/api/healthz
# → {"status":"ok"}
```

---

## Step 6 — Seed some data (first time only)

The database is empty on first run. Add a few classes and instructors via the admin
dashboard (Step 7), or use curl:

```bash
# Add an instructor
curl -X POST http://localhost:3000/api/instructors \
  -H "Content-Type: application/json" \
  -d '{"name":"Sara Ahmed","specialties":["Ballet","Contemporary"],"experienceYears":8,"isActive":true}'

# Add a class (use the instructor id returned above, e.g. 1)
curl -X POST http://localhost:3000/api/classes \
  -H "Content-Type: application/json" \
  -d '{"title":"Ballet Foundations","category":"Ballet","instructorId":1,"level":"Beginner","durationMins":60,"capacity":15,"isActive":true}'

# Add a schedule for that class (classId=1, Monday=1, 10:00-11:00)
curl -X POST http://localhost:3000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{"classId":1,"dayOfWeek":1,"startTime":"10:00","endTime":"11:00","location":"Studio A","isRecurring":true}'
```

---

## Step 7 — Run the Admin dashboard

Open a new terminal tab:

```bash
cd artifacts/admin
pnpm run dev
```

Opens on **http://localhost:5173** (or the next available port).

You can now create and manage:
- Instructors, Classes, Schedules
- Price Packages
- Bookings, Students
- Attendance, Notifications, Marketing

---

## Step 8 — Run the Mobile app

Open another terminal tab:

```bash
cd artifacts/central
pnpm run dev
# or: npx expo start
```

A QR code appears in the terminal. Choose your method:

### Option A — Physical phone (easiest)
1. Install **Expo Go** from the App Store or Google Play
2. Scan the QR code with your camera (iOS) or the Expo Go app (Android)
3. Make sure your phone and Mac are on the **same Wi-Fi network**
4. Set `EXPO_PUBLIC_API_URL` to your Mac's LAN IP (e.g. `http://192.168.1.50:3000`)

### Option B — iOS Simulator (Mac only)
1. Press `i` in the Expo terminal
2. Xcode's simulator launches automatically
3. `localhost:3000` works directly — no IP change needed

### Option C — Android Emulator
1. Open Android Studio → open AVD Manager → start an emulator
2. Press `a` in the Expo terminal
3. Use `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000` (Android's alias for host localhost)

---

## Step 9 — End-to-end smoke test

Once everything is running:

1. **Admin:** Go to http://localhost:5173 → add 1 instructor + 1 class
2. **Mobile:** Open the app → go to **Classes** tab → the class appears (live from API)
3. **Mobile:** Tap the class → tap **Book This Class** → complete the 3-step flow
4. **Admin:** Go to http://localhost:5173/bookings → the booking appears in the table

That confirms the full loop: mobile → API → database → admin.

---

## All running — terminal layout

```
Tab 1:  cd artifacts/api-server   && pnpm run dev    → :3000
Tab 2:  cd artifacts/admin        && pnpm run dev    → :5173
Tab 3:  cd artifacts/central      && pnpm run dev    → Expo QR
```

---

## Useful commands

```bash
# Check API routes
curl http://localhost:3000/api/classes
curl http://localhost:3000/api/instructors
curl http://localhost:3000/api/bookings

# Open Drizzle Studio (visual DB browser)
DATABASE_URL="..." pnpm --filter @workspace/db run studio
# → opens http://local.drizzle.studio

# Run a new migration after schema changes
DATABASE_URL="..." pnpm --filter @workspace/db run generate   # generate SQL
DATABASE_URL="..." pnpm --filter @workspace/db run migrate    # apply it

# TypeCheck everything
pnpm run typecheck
```

> Migrations never run automatically at API or worker startup — they are always
> an explicit step. Locally, `pnpm run dev` (api-server) applies them before
> starting; in production, Railway applies them as a pre-deploy step
> (see DEPLOY.md).

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `DATABASE_URL must be set` | Check `.env` exists in `artifacts/api-server/` |
| `Refusing to use remote Railway database` | Your `DATABASE_URL` points at the production Railway DB (`…proxy.rlwy.net`). Switch to a local Postgres URL (Step 1). Only for deliberate emergency operations: `ALLOW_REMOTE_DATABASE_LOCAL=true` |
| Mobile app shows "Couldn't reach server" | Check `EXPO_PUBLIC_API_URL` is set to your machine's IP, not localhost, when on a physical device |
| Admin shows blank / no data | API server must be running on :3000; check CORS if you changed the port |
| `pnpm install` fails | Make sure you're in the repo root (`Central-Studio-System-main/`), not inside an artifact folder |
| Port 3000 already in use | `lsof -i :3000` to find the process, kill it, or change `PORT` in `.env` |
| Expo QR not working | Try pressing `w` to open in the browser first to confirm the bundle builds |
