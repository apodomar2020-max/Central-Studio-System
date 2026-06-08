# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM (timestamps use `mode: "string"`)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec at `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (12 tables)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — generated Zod schemas (do not edit)
- `artifacts/api-server/src/routes/` — Express route handlers (15 files)
- `artifacts/admin/src/pages/` — Admin dashboard pages (13 pages)

---

## Central Studio Admin (artifacts/admin)

React + Vite admin dashboard at `/admin/`. Full CRUD for all 12 database entities.

### Pages & Features
- **Dashboard** — 10 live stat cards + 4 recharts analytics charts (bookings pie, applications bar, Studio/Stage progress bars)
- **Instructors** — list, add, edit, delete. Specialties as tags.
- **Classes** — list, add, edit, delete. Instructor dropdown from live data.
- **Schedules** — list, add, edit, delete. Class dropdown, day/time pickers.
- **Packages** — list, add, edit, delete. Featured star indicator.
- **Bookings** — list, add, edit, delete. Status badge (pending/confirmed/completed/cancelled).
- **Students** — list, add, edit, delete.
- **Offers** — list, add, edit, delete. Discount badge, class IDs.
- **Opportunities** — list, add, edit, delete. Company color badge.
- **Applications** — list, edit status (pending/accepted/rejected), delete. **Auto-creates Dancer on accept.**
- **Notifications** — list, create, edit, delete. Draft/Sent status, target audience.
- **Dancers** (Stage) — rich profile cards with dance styles, social links, stats; full CRUD. Auto-synced from accepted applications.
- **Marketing** — WhatsApp & email campaign management. Create → preview → send flow. Tracks recipients/sent count by audience type.

### Tech
shadcn/ui components, recharts, wouter routing, @tanstack/react-query, react-hook-form + zod

---

## Central Studio & Stage (artifacts/central)

Cross-platform mobile app for a dance school in Egypt. Built with Expo React Native + Expo Router. **No backend — AsyncStorage only.**

### Dual Mode
- **Central Studio** (`/(tabs)/`) — browse & book dance classes. Brand: #FFD400 on #0B0B0F
- **Central Stage** (`/(stage)/`) — professional dancer profiles for booking. Brand: #8A5CFF on #08080D

---

## Architecture decisions

- All DB timestamps use `mode: "string"` so Drizzle returns ISO strings, avoiding Zod parse errors
- Orval codegen regenerates both `api-client-react` and `api-zod` from one OpenAPI spec; run after any spec change
- Forms with array fields (specialties, classIds, requirements, danceStyles) store as comma strings in form state and split before submitting
- Dashboard analytics uses a separate `/dashboard/analytics` endpoint to keep stat cards and chart data independent
- Dancers table stores danceStyles/specialties as JSON strings (TEXT column) to avoid array type complexity with Drizzle
- Auto-promotion: when application status → "accepted", API route checks for existing dancer by applicationId before inserting (idempotent)
- Marketing campaigns compute recipientCount server-side by querying actual students/dancers tables

## Gotchas

- After editing `openapi.yaml`, always run `pnpm --filter @workspace/api-spec run codegen`
- Do NOT edit generated files in `lib/api-client-react/src/generated/` or `lib/api-zod/src/generated/`
- Zod transform fields in react-hook-form: split arrays manually in `onSubmit`, never use `.transform()` in schema
- Dancers danceStyles/specialties: stored as JSON strings in DB, parsed in API route before sending to client
