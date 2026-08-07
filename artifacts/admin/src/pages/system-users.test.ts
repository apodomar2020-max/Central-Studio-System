/**
 * Source-inspection coverage for the Phase 1 System Users / Roles delegated-
 * access fix — same style as branches.test.ts / calendarScheduleNavigationWiring.test.ts
 * (this app has no React component-rendering test harness, so existing
 * frontend coverage confirms expected code patterns are present in the real
 * source rather than mounting components — see
 * SYSTEM_USERS_ROLES_PERMISSIONS_INVESTIGATION_REPORT.md §N).
 *
 * What this locks in:
 *  - The page no longer hard-gates all content behind isSuperAdmin (the
 *    confirmed blocker, D1) — it checks adminUsers.view / roles.view instead.
 *  - The roles list is only fetched when the admin can actually read it
 *    (roles.view / Super Admin) — not "only for Super Admin" (D2).
 *  - Every mutation control (New User, Edit user fields/role/active, New
 *    Role, Edit Role details/permissions) is individually gated on its own
 *    backend-enforced permission, not on tab access alone.
 *  - The stale "Phase 3" placeholder copy is gone.
 *
 * What this file CANNOT verify (no rendering harness available) — see the
 * manual verification checklist in the Phase 1 implementation report.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./system-users.tsx", import.meta.url), "utf8");

// ─── D1/D2: the page is delegated, not Super-Admin-only ────────────────────

test("the page no longer hard-gates all content on isSuperAdmin alone", () => {
  assert.doesNotMatch(
    source,
    /if\s*\(\s*!currentUser\?\.isSuperAdmin\s*\)/,
    "the full-page Super-Admin-only gate must be gone",
  );
});

test("the stale 'Phase 3' placeholder copy is removed", () => {
  assert.doesNotMatch(source, /Phase 3/);
  assert.doesNotMatch(source, /Management remains Super Admin-only/);
});

test("page-level access is derived from adminUsers.view / roles.view (or Super Admin), not isSuperAdmin alone", () => {
  assert.match(source, /canViewUsers\s*=\s*isSuperAdmin\s*\|\|\s*can\("adminUsers",\s*"view"\)/);
  assert.match(source, /canViewRoles\s*=\s*isSuperAdmin\s*\|\|\s*can\("roles",\s*"view"\)/);
});

test("a user with neither permission still gets a real Access Denied screen, not silent/blank content", () => {
  assert.match(source, /import\s*\{\s*AccessDenied\s*\}\s*from\s*"@\/components\/access-denied"/);
  assert.match(source, /if\s*\(!canViewUsers\s*&&\s*!canViewRoles\)\s*\{\s*\n\s*return <AccessDenied/);
});

test("each tab renders only when its own view permission is held", () => {
  assert.match(source, /\{canViewUsers\s*&&\s*<TabsTrigger value="users">/);
  assert.match(source, /\{canViewRoles\s*&&\s*<TabsTrigger value="roles">/);
  assert.match(source, /\{canViewUsers\s*&&\s*\(\s*\n\s*<TabsContent value="users">/);
  assert.match(source, /\{canViewRoles\s*&&\s*\(\s*\n\s*<TabsContent value="roles">/);
});

// ─── D2: roles are fetched only when readable, not "only for Super Admin" ──

test("the roles query is gated on canViewRoles, not on 'currentUser?.isSuperAdmin === true'", () => {
  assert.doesNotMatch(
    source,
    /useRoles\(currentUser\?\.isSuperAdmin === true\)/,
    "must not still require Super Admin specifically to fetch roles",
  );
  assert.match(source, /useRoles\(canViewRoles\)/);
});

// ─── Mutation controls are scoped to their exact backend permission ────────

test("New User is gated on adminUsers.create", () => {
  assert.match(source, /canCreate\s*=\s*isSuperAdmin\s*\|\|\s*can\("adminUsers",\s*"create"\)/);
  assert.match(source, /\{canCreate\s*&&\s*\(\s*\n\s*<div className="flex justify-end mb-4">\s*\n\s*<Button onClick=\{\(\) => setShowCreate\(true\)\}[^]*?New User/);
});

test("basic field edits are gated on adminUsers.edit", () => {
  assert.match(source, /canEditFields\s*=\s*isSuperAdmin\s*\|\|\s*can\("adminUsers",\s*"edit"\)/);
});

test("role assignment is gated on adminUsers.assignRole AND roles being viewable", () => {
  assert.match(
    source,
    /canAssignRole\s*=\s*\(isSuperAdmin\s*\|\|\s*can\("adminUsers",\s*"assignRole"\)\)\s*&&\s*canViewRoles/,
  );
});

test("the active/inactive toggle is gated on adminUsers.disable", () => {
  assert.match(source, /canDisable\s*=\s*isSuperAdmin\s*\|\|\s*can\("adminUsers",\s*"disable"\)/);
});

test("a row's Edit affordance only renders when at least one user-mutation permission is held", () => {
  assert.match(source, /canEditAnything\s*=\s*canEditFields\s*\|\|\s*canAssignRole\s*\|\|\s*canDisable/);
  assert.match(source, /\{canEditAnything\s*&&\s*<TableHead className="w-10" \/>\}/);
});

test("New Role is gated on roles.create", () => {
  assert.match(source, /canCreate\s*=\s*isSuperAdmin\s*\|\|\s*can\("roles",\s*"create"\)/);
});

test("role name/description edits are gated on roles.edit", () => {
  assert.match(source, /canEditDetails\s*=\s*isSuperAdmin\s*\|\|\s*can\("roles",\s*"edit"\)/);
});

test("the permission matrix is gated on roles.assignPermissions, independent of roles.edit", () => {
  assert.match(source, /canAssignPermissions\s*=\s*isSuperAdmin\s*\|\|\s*can\("roles",\s*"assignPermissions"\)/);
  assert.match(source, /disabled=\{!canAssignPermissions\}/);
});

test("a role's Edit affordance only renders when at least one role-mutation permission is held", () => {
  assert.match(source, /canEditAnyRole\s*=\s*canEditDetails\s*\|\|\s*canAssignPermissions/);
});

// ─── Backend contract preserved: UI never sends fields it isn't allowed to ──

test("the role PATCH/POST body omits the 'permissions' key entirely when the admin can't assign permissions", () => {
  // PATCH/POST /admin/roles requires roles.assignPermissions the instant the
  // body has a "permissions" key at all — the UI must never send it blind.
  assert.match(source, /if\s*\(canAssignPermissions\)\s*body\["permissions"\]\s*=\s*permissions;/);
});

test("the create-user body only includes roleId when the picker was actually usable", () => {
  assert.match(source, /\.\.\.\(canAssignRole && form\.roleId \? \{ roleId: parseInt\(form\.roleId\) \} : \{\}\)/);
});
