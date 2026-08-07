# System Users / Roles / Permissions — Phase 1 Closure Implementation Report

**Scope:** Close the confirmed blocker from `SYSTEM_USERS_ROLES_PERMISSIONS_INVESTIGATION_REPORT.md` (D1/D2) — the Admin UI hard-gated System Users & Roles to `isSuperAdmin` despite the backend, route guard, and sidebar already supporting delegated access. No commits, no deployment, no migration, no production database access.

---

## Starting branch/commit

- Base: `main` @ `8a269bb` ("fix: filter ballet students roster to active enrollments")
- Work branch: `fix/system-users-roles-delegated-access` (created from `main`, not pushed, not merged)

## Files changed

| File | Change |
|---|---|
| [artifacts/admin/src/pages/system-users.tsx](artifacts/admin/src/pages/system-users.tsx) | Core fix — delegated permission gating (D1/D2) + per-control permission scoping |
| [artifacts/admin/src/components/access-denied.tsx](artifacts/admin/src/components/access-denied.tsx) | Stale comment fix (D9) |
| [artifacts/admin/src/pages/system-users.test.ts](artifacts/admin/src/pages/system-users.test.ts) | New — source-inspection regression tests (repo's existing frontend test convention) |
| [artifacts/api-server/src/routes/adminAuth.integration.test.ts](artifacts/api-server/src/routes/adminAuth.integration.test.ts) | New — 31 real-route integration tests for the auth/RBAC substrate |
| `SYSTEM_USERS_ROLES_PERMISSIONS_PHASE1_CLOSURE_REPORT.md` | This report |

**No backend application code was modified.** `adminAuth.ts` and every other backend file are byte-for-byte unchanged — confirmed via `git status`/`git diff` throughout. No migrations, no seed data, no schema changes, no mobile app changes, no Finance/Ballet/Booking/Attendance/Package business logic changes.

---

## Current behavior before fix

`system-users.tsx`'s `SystemUsersPage` rendered a static "Management remains Super Admin-only… will be enabled for delegated permissions in Phase 3" placeholder for **any** admin whose `isSuperAdmin` flag was `false` — regardless of whether their role held `adminUsers.view`/`roles.view`. The roles query was `enabled: currentUser?.isSuperAdmin === true`, so it never fired for a delegated admin either. This was true even though:
- The route guard (`App.tsx` `ROUTE_PERMS.systemUsers`) already required only `adminUsers.view` OR `roles.view`.
- The sidebar link (`nav-config.ts`) used the same permission pair.
- The backend (`adminAuth.ts`) already enforced `adminUsers.*`/`roles.*` permissions independently per-endpoint, with no Super-Admin-only requirement on the read/write paths themselves.

## Implemented changes

**`system-users.tsx` (the core fix):**
- Removed the `if (!currentUser?.isSuperAdmin)` full-page gate and the "Phase 3" placeholder entirely.
- Page-level access is now `canViewUsers = isSuperAdmin || can("adminUsers","view")` and `canViewRoles = isSuperAdmin || can("roles","view")`. A user with neither now falls through to the shared `<AccessDenied>` component (defensive fallback only — `RouteGuard` already blocks this case before the page mounts).
- The Users tab and Roles tab each render independently based on their own view permission; the visible tab list and the default tab adapt to what the current admin can actually see.
- `useRoles()` is now gated on `canViewRoles`, not `isSuperAdmin === true` — since `GET /api/admin/roles` itself requires `roles.view` on the backend, this means the roles list is fetched **only** when it would actually succeed. An `adminUsers.view`-only admin's Users tab never issues that request.
- Every mutation control is now scoped to its own exact backend-enforced permission, matching the task's spec exactly:
  - **New User** → `adminUsers.create`
  - **Edit user** full name/email/password → `adminUsers.edit`
  - **Role assignment** control (in both Create and Edit user dialogs) → `adminUsers.assignRole` **and** `roles.view` (there's nothing to pick from otherwise — the picker is disabled with an explanatory note rather than silently empty)
  - **Active/inactive toggle** → `adminUsers.disable`
  - **New Role** → `roles.create`
  - **Role name/description** edits → `roles.edit`
  - **Permission matrix** (in `RoleDialog`, reused by both Create and Edit) → `roles.assignPermissions`; when absent, the matrix renders read-only (all checkboxes and Select-all/Clear buttons disabled) instead of being hidden, so a `roles.view`-only admin can still see what a role grants
  - A user row's Edit button and a role's Edit button are hidden entirely when the current admin holds none of the permissions that button would unlock (view-only admins see no dead-end affordances)
- The request bodies sent to the backend were tightened to match what the UI now allows: `roleId` is only included in the create/edit body when the role picker was actually usable, and the `permissions` key is **omitted entirely** (not sent as unchanged) from role create/edit bodies when the admin lacks `roles.assignPermissions` — because the backend treats the mere presence of a `permissions` key in the body as requiring that permission, independent of whether the value changed.
- Existing self-service and Super-Admin-target restrictions (self-disable, self-role-change, "only another Super Admin can modify a Super Admin account") were preserved and now composed with the new permission checks rather than replaced.

**`access-denied.tsx`:** the comment claiming "the backend is not guarded yet" was corrected — it now states the backend independently enforces the same permission via `requireAdminPermission` on every route, and that this screen is presentation-only.

## Backend safety invariants verified

All of the following were confirmed **unchanged** (zero backend files touched) and additionally now have dedicated automated test coverage (see below):
- `isSuperAdmin` cannot be set via `POST /admin/users` or `PATCH /admin/users/:id` body, for any caller including Super Admin.
- An admin cannot change their own role (`Cannot change your own role`).
- An admin cannot disable their own account (`Cannot disable your own account`), including a lone Super Admin.
- The last active Super Admin cannot be deactivated — verified both in isolation and under a genuine concurrent-request race (two simultaneous mutual-deactivation requests between the last two active Super Admins), proving the `pg_advisory_xact_lock` actually closes the TOCTOU window it exists for.
- A non-Super-Admin cannot assign a role permission they do not themselves hold (`permissionsAreWithinAuthority`), including on both role creation and role self-edit.
- `passwordHash` never appears in any response body checked (login, `/me`, list, create).
- Only another Super Admin can modify a Super Admin account.
- JWT claims are cosmetic — a forged `isSuperAdmin:true` claim on a token for a non-Super-Admin DB user is still rejected, because `loadAdminIdentity` re-derives identity from the database on every request.

## Tests added/updated

**Backend — `artifacts/api-server/src/routes/adminAuth.integration.test.ts` (new, 31 tests):**
Boots the real built server (`dist/index.mjs`) against a dedicated disposable local Postgres database (`central_studio_disposable_admin_rbac` — separate from the shared `central_studio_disposable_hotfix` used by the Finance test suite, specifically so the Super Admin count invariants tested here are exact and not affected by other test files' fixtures). Covers, exactly per the task's list: login success/failure/inactive-account, `requireAdminAuth` (missing/invalid/deactivated/nonexistent token, DB-authoritative re-check), `requireAdminPermission` (Super Admin bypass, granted, denied), System Users list/create/update permission gating (edit/assignRole/disable independently), Roles list/create/update permission gating, self-disable block, self-role-change block, last-Super-Admin block (including the concurrency race), `isSuperAdmin` injection rejection (create and update), non-Super-Admin authority-scoping (both the reject and the positive-control accept case), and passwordHash absence.

**Frontend — `artifacts/admin/src/pages/system-users.test.ts` (new, 17 tests):**
The admin package has **no React component-rendering test harness** (no vitest/testing-library/jsdom anywhere in the workspace) — its existing frontend test convention (`branches.test.ts`, `calendarScheduleNavigationWiring.test.ts`, and others) is `node:test` + regex assertions against the raw `.tsx` source, explicitly documented in those files as a deliberate substitute for component mounting. This file follows that exact convention rather than introducing a new framework, per the task's instruction. It locks in: the old `isSuperAdmin`-only gate and "Phase 3" copy are gone; page/tab access is derived from `adminUsers.view`/`roles.view`; the roles query is gated on `canViewRoles` not `isSuperAdmin`; every one of the seven mutation controls is gated on its named permission; and the two backend-contract-preserving behaviors (omitting `permissions` when not assignable, omitting `roleId` when not assignable). I confirmed these assertions are meaningful, not vacuous, by running the `doesNotMatch` checks against the pre-fix source (`git show HEAD:...`) and confirming they matched (i.e., would have failed the new test) there.

## Test results

```
adminAuth.integration.test.ts:  31 pass, 0 fail  (run 3x consecutively — stable, no flakiness observed)
system-users.test.ts:           17 pass, 0 fail
financeRolesPermissions.integration.test.ts (pre-existing, re-run as a regression check): 11 pass, 0 fail
```

## Typecheck/build results

- `artifacts/admin` — `pnpm run typecheck`: **0 errors.**
- `artifacts/admin` — `pnpm run build`: **succeeds** (2906 modules, 6.48s; pre-existing sourcemap warnings and a chunk-size advisory, both unrelated to this change).
- `artifacts/api-server` — `pnpm run typecheck`: **157 pre-existing baseline errors**, all in files this change never touched (`balletCancellationRefunds.ts`, and ~20 unrelated `*.integration.test.ts` files with pre-existing `pg`-types/ESM/overload issues). Verified exactly zero new errors: running typecheck with the new `adminAuth.integration.test.ts` present vs. temporarily removed produced the identical count (157 both times). `adminAuth.ts` itself has zero errors, before and after.
- Workspace `pnpm run typecheck` (root): fails only due to the same pre-existing `api-server` baseline errors; `admin` and `lib/*` typecheck cleanly within it.

## Manual checks performed (live browser verification, not just automated)

Beyond the automated suites, I ran the actual app end-to-end: built `dist/index.mjs`, ran it against the dedicated disposable DB, started the real Vite dev server, and logged in as four seeded test accounts (Super Admin, `adminUsers.view`-only, `roles.view`-only, no-permission) to click through the real UI:
- **`adminUsers.view`-only**: Users tab renders with real data; no Roles tab in the tab list; no "New User" button; no Edit column; role names for other users correctly fall back to "Role assigned" (not the real name, since this admin can't call `GET /admin/roles`) or "No role". Network log confirmed **only** `GET /api/admin/users` was called — `GET /api/admin/roles` was never requested.
- **`roles.view`-only**: Roles tab renders with real data (all three seeded roles, correct permission badges); no Users tab; no "New Role" button; no Edit buttons on any role. Network log confirmed **only** `GET /api/admin/roles` was called.
- **No permission**: direct navigation to `/system-users` renders `AccessDenied` (the route guard, before the page component even mounts) with the sidebar's System group absent entirely; no `GET /api/admin/users` or `/roles` calls; no console errors.
- **Super Admin**: both tabs, all data (including real role names for every user), "New User" and "New Role" buttons, and Edit affordances on every row — full regression check passed, no capability lost.

## Remaining Phase 2 decisions (not addressed — explicitly out of scope for this closure)

1. **`adminUsers.delete` / `roles.delete`** — these permissions are still selectable in the UI's permission matrix and still correspond to no backend endpoint (no delete route exists for either). Per the task's instructions, no delete endpoints were added and nothing was removed from the catalog in this phase.
2. **`auditLogs.export`** — still an unused, UI-selectable permission with no export endpoint or button behind it.
3. **`ballet.payments.view` vs `finance.view`** — the mismatch stands: the checkbox exists, but the real read-gate for ballet payment data is `finance.view`.
4. **Seeded Super Admin credential rotation / second-Super-Admin runbook** — the documented default credential from migration `0007` and the lack of any in-app path to create a second Super Admin remain exactly as described in the investigation report; neither was touched here (no migrations, no seed data changes were permitted in this phase).

## Final status

**PASS**

The confirmed blocker (D1/D2) is closed: delegated `adminUsers.view`/`roles.view` access now works end-to-end, verified by 48 new automated tests (31 backend + 17 frontend) and live manual verification across four permission levels, with zero backend files touched, zero new typecheck errors, a clean admin build, and no regression to any existing Super Admin safety guard.
