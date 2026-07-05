/**
 * Admin authentication routes — /api/admin/auth/*
 *
 * These routes are protected by the shared API key middleware (same as all
 * other /api routes), but they issue their own short-lived JWTs that
 * subsequent admin requests must supply in the X-Admin-Token header.
 *
 * Why separate JWTs instead of reusing the shared API key?
 * The shared API key is a single long-lived secret baked into the mobile APK —
 * it identifies the app, not a person. Admin JWTs identify individual admin
 * users and carry their role/permissions, enabling per-user access control.
 *
 * Routes:
 *   POST /api/admin/auth/login        — exchange username+password for JWT
 *   GET  /api/admin/auth/me           — return current admin user from JWT
 *   POST /api/admin/auth/logout       — client-side token discard (stateless)
 *
 *   GET  /api/admin/users             — list system users (Super Admin only)
 *   POST /api/admin/users             — create system user (Super Admin only)
 *   PATCH /api/admin/users/:id        — update user / change password / toggle active
 *   DELETE /api/admin/users/:id       — deactivate (soft delete) user
 *
 *   GET  /api/admin/roles             — list roles
 *   POST /api/admin/roles             — create role
 *   PATCH /api/admin/roles/:id        — update role permissions
 *   DELETE /api/admin/roles/:id       — delete role
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, systemUsersTable, rolesTable } from "@workspace/db";
import type { RolePermissions } from "@workspace/db";
import { countCatalogPermissions, hasRolePermission, PERMISSION_CATALOG } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { logActivity } from "../lib/activityLog";

const router: IRouter = Router();

// ─── JWT helpers ──────────────────────────────────────────────────────────────

const JWT_SECRET = process.env["ADMIN_JWT_SECRET"] ?? "dev-admin-secret-change-in-production";
const JWT_EXPIRES_IN = "8h"; // admin session lasts 8 hours

// Guard: in production a missing secret means admin JWTs can be forged with
// the public default value — abort startup rather than silently run insecurely.
if (!process.env["ADMIN_JWT_SECRET"]) {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "ADMIN_JWT_SECRET must be set in production. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
}

interface AdminTokenPayload {
  sub: number;         // system_user.id
  username: string;
  isSuperAdmin: boolean;
  roleId: number | null;
}

interface AdminRoleIdentity {
  id: number;
  name: string;
  permissions: RolePermissions;
}

/**
 * Database-authoritative admin identity attached to protected requests.
 * JWT role and Super Admin claims are intentionally replaced with current DB
 * values on every request so disabling or reassigning an admin takes effect
 * without waiting for the token to expire.
 */
export interface AdminIdentity {
  sub: number;
  id: number;
  username: string;
  fullName: string;
  email: string;
  isSuperAdmin: boolean;
  roleId: number | null;
  isActive: true;
  role: AdminRoleIdentity | null;
  permissions: RolePermissions;
}

function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyAdminToken(token: string): AdminTokenPayload {
  const payload = jwt.verify(token, JWT_SECRET) as unknown as AdminTokenPayload;
  if (!Number.isInteger(payload.sub) || payload.sub <= 0) {
    throw new jwt.JsonWebTokenError("Invalid admin token subject");
  }
  return payload;
}

async function loadAdminIdentity(userId: number): Promise<AdminIdentity | null> {
  const [user] = await db
    .select({
      id: systemUsersTable.id,
      username: systemUsersTable.username,
      fullName: systemUsersTable.fullName,
      email: systemUsersTable.email,
      roleId: systemUsersTable.roleId,
      isSuperAdmin: systemUsersTable.isSuperAdmin,
      isActive: systemUsersTable.isActive,
    })
    .from(systemUsersTable)
    .where(eq(systemUsersTable.id, userId))
    .limit(1);

  if (!user || !user.isActive) return null;

  let role: AdminRoleIdentity | null = null;
  if (user.roleId != null) {
    const [currentRole] = await db
      .select({
        id: rolesTable.id,
        name: rolesTable.name,
        permissions: rolesTable.permissions,
      })
      .from(rolesTable)
      .where(eq(rolesTable.id, user.roleId))
      .limit(1);

    if (currentRole) {
      role = {
        id: currentRole.id,
        name: currentRole.name,
        permissions: currentRole.permissions as RolePermissions,
      };
    }
  }

  return {
    sub: user.id,
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
    roleId: user.roleId,
    isActive: true,
    role,
    permissions: role?.permissions ?? {},
  };
}

// ─── Admin auth middleware ─────────────────────────────────────────────────────
// Attach to any route that requires a logged-in admin user.

export interface AdminRequest extends Request {
  adminUser?: AdminIdentity;
}

export async function requireAdminAuth(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers["x-admin-token"];
  if (typeof token !== "string" || token.length === 0) {
    res.status(401).json({ error: "Admin token required" });
    return;
  }

  let payload: AdminTokenPayload;
  try {
    payload = verifyAdminToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired admin token" });
    return;
  }

  try {
    const identity = await loadAdminIdentity(payload.sub);
    if (!identity) {
      res.status(401).json({ error: "Admin account not found or inactive" });
      return;
    }

    req.adminUser = identity;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireSuperAdmin(req: AdminRequest, res: Response, next: NextFunction): void {
  if (!req.adminUser) {
    res.status(401).json({ error: "Admin authentication required" });
    return;
  }
  if (!req.adminUser?.isSuperAdmin) {
    res.status(403).json({ error: "Super Admin access required" });
    return;
  }
  next();
}

/**
 * Action-level permission guard for Phase 3 route enforcement.
 * Must be mounted after requireAdminAuth so req.adminUser is DB-hydrated.
 */
export function requireAdminPermission(moduleKey: string, actionKey: string) {
  return (req: AdminRequest, res: Response, next: NextFunction): void => {
    const admin = req.adminUser;
    if (!admin) {
      res.status(401).json({ error: "Admin authentication required" });
      return;
    }

    if (admin.isSuperAdmin || hasRolePermission(admin.permissions, moduleKey, actionKey)) {
      next();
      return;
    }

    res.status(403).json({
      error: "Permission denied",
      requiredPermission: { module: moduleKey, action: actionKey },
    });
  };
}

function adminHasPermission(admin: AdminIdentity, moduleKey: string, actionKey: string): boolean {
  return admin.isSuperAdmin || hasRolePermission(admin.permissions, moduleKey, actionKey);
}

function requireAllAdminPermissions(
  req: AdminRequest,
  res: Response,
  required: Array<[moduleKey: string, actionKey: string]>,
): boolean {
  const admin = req.adminUser;
  if (!admin) {
    res.status(401).json({ error: "Admin authentication required" });
    return false;
  }

  const missing = required.filter(([moduleKey, actionKey]) =>
    !adminHasPermission(admin, moduleKey, actionKey),
  );
  if (missing.length === 0) return true;

  res.status(403).json({
    error: "Permission denied",
    requiredPermissions: missing.map(([module, action]) => ({ module, action })),
  });
  return false;
}

function permissionsAreWithinAuthority(admin: AdminIdentity, requested: RolePermissions): boolean {
  if (admin.isSuperAdmin) return true;

  return Object.entries(requested).every(([moduleKey, actions]) => {
    const canonicalModule = PERMISSION_CATALOG.find(
      (module) => module.key === moduleKey || module.legacyAliases?.includes(moduleKey),
    )?.key ?? moduleKey;
    return Object.entries(actions ?? {}).every(([actionKey, enabled]) =>
      enabled !== true || hasRolePermission(admin.permissions, canonicalModule, actionKey),
    );
  });
}

class AdminMutationError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

// ─── POST /api/admin/auth/login ───────────────────────────────────────────────
const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post("/admin/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const { username, password } = parsed.data;

  const [user] = await db
    .select()
    .from(systemUsersTable)
    .where(eq(systemUsersTable.username, username.trim().toLowerCase()));

  if (!user || !user.isActive) {
    await logActivity(req as AdminRequest, {
      action: "loginFailed",
      module: "auth",
      entityType: "admin_session",
      entityLabel: username.trim().toLowerCase(),
      after: {
        username: username.trim().toLowerCase(),
        reason: user ? "inactive" : "not_found",
      },
      summary: `Failed admin login for ${username.trim().toLowerCase()}`,
    });
    res.status(401).json({ error: "Invalid credentials or account is inactive" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    logger.warn({ username }, "Failed admin login attempt");
    await logActivity(req as AdminRequest, {
      action: "loginFailed",
      module: "auth",
      entityType: "admin_session",
      entityId: user.id,
      entityLabel: user.username,
      after: {
        username: user.username,
        reason: "invalid_password",
      },
      summary: `Failed admin login for ${user.username}`,
    });
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = signAdminToken({
    sub: user.id,
    username: user.username,
    isSuperAdmin: user.isSuperAdmin,
    roleId: user.roleId,
  });

  // Load role permissions for the response
  let roleData = null;
  if (user.roleId) {
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, user.roleId));
    roleData = role ?? null;
  }

  logger.info({ userId: user.id, username: user.username }, "Admin logged in");
  await logActivity(req as AdminRequest, {
    action: "login",
    module: "auth",
    entityType: "admin_session",
    entityId: user.id,
    entityLabel: user.username,
    after: {
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      roleId: user.roleId,
      isSuperAdmin: user.isSuperAdmin,
    },
    summary: `Admin ${user.username} logged in`,
  });

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      roleId: user.roleId,
      isActive: user.isActive,
      role: roleData ? { id: roleData.id, name: roleData.name, permissions: roleData.permissions } : null,
    },
  });
});

// ─── GET /api/admin/auth/me ───────────────────────────────────────────────────
router.get("/admin/auth/me", requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const admin = req.adminUser!;

  res.json({
    id: admin.id,
    username: admin.username,
    fullName: admin.fullName,
    email: admin.email,
    isSuperAdmin: admin.isSuperAdmin,
    roleId: admin.roleId,
    isActive: admin.isActive,
    role: admin.role,
    permissions: admin.permissions,
  });
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
router.get("/admin/users", requireAdminAuth, requireAdminPermission("adminUsers", "view"), async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id: systemUsersTable.id,
      username: systemUsersTable.username,
      email: systemUsersTable.email,
      fullName: systemUsersTable.fullName,
      roleId: systemUsersTable.roleId,
      isSuperAdmin: systemUsersTable.isSuperAdmin,
      isActive: systemUsersTable.isActive,
      createdAt: systemUsersTable.createdAt,
    })
    .from(systemUsersTable)
    .orderBy(systemUsersTable.createdAt);

  res.json(users);
});

// ─── POST /api/admin/users ────────────────────────────────────────────────────
const CreateUserBody = z.object({
  username: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/, "Username must be lowercase letters, numbers, or underscores"),
  email: z.string().email(),
  fullName: z.string().min(2),
  password: z.string().min(8, "Password must be at least 8 characters"),
  roleId: z.coerce.number().int().optional(),
});

router.post("/admin/users", requireAdminAuth, requireAdminPermission("adminUsers", "create"), async (req: AdminRequest, res): Promise<void> => {
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "isSuperAdmin")) {
    res.status(400).json({ error: "Super Admin status cannot be assigned through this endpoint." });
    return;
  }

  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { username, email, fullName, password, roleId } = parsed.data;

  let role: { id: number; permissions: RolePermissions } | undefined;
  if (roleId != null) {
    if (!requireAllAdminPermissions(req, res, [["adminUsers", "assignRole"]])) return;
    [role] = await db
      .select({ id: rolesTable.id, permissions: rolesTable.permissions })
      .from(rolesTable)
      .where(eq(rolesTable.id, roleId))
      .limit(1) as Array<{ id: number; permissions: RolePermissions }>;
    if (!role) {
      res.status(400).json({ error: "Invalid role ID." });
      return;
    }
    if (!permissionsAreWithinAuthority(req.adminUser!, role.permissions)) {
      res.status(403).json({ error: "Cannot assign permissions beyond your authority." });
      return;
    }
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [existing] = await db
    .select({ id: systemUsersTable.id })
    .from(systemUsersTable)
    .where(eq(systemUsersTable.username, username));

  if (existing) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const [newUser] = await db
    .insert(systemUsersTable)
    .values({ username, email, fullName, passwordHash, roleId: roleId ?? null })
    .returning({
      id: systemUsersTable.id,
      username: systemUsersTable.username,
      email: systemUsersTable.email,
      fullName: systemUsersTable.fullName,
      roleId: systemUsersTable.roleId,
      isActive: systemUsersTable.isActive,
    });

  logger.info({ newUserId: newUser.id, by: req.adminUser?.sub }, "System user created");
  // Phase 7B pilot: unified activity log (safe fields only — never password data).
  await logActivity(req, {
    action: "create",
    module: "adminUsers",
    entityType: "system_user",
    entityId: newUser.id,
    entityLabel: newUser.username,
    after: {
      username: newUser.username,
      email: newUser.email,
      fullName: newUser.fullName,
      roleId: newUser.roleId,
      isActive: newUser.isActive,
    },
    summary: `Created admin user ${newUser.username}`,
  });
  res.status(201).json(newUser);
});

// ─── PATCH /api/admin/users/:id ───────────────────────────────────────────────
const UpdateUserBody = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  roleId: z.coerce.number().int().nullable().optional(),
  isActive: z.boolean().optional(),
});

router.patch("/admin/users/:id", requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "isSuperAdmin")) {
    const isSelfDemotion = id === req.adminUser?.sub && req.body?.isSuperAdmin === false;
    res.status(400).json({
      error: isSelfDemotion
        ? "Cannot remove your own Super Admin authority."
        : "Super Admin status cannot be changed through this endpoint.",
    });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }); return; }

  const updates: Partial<typeof systemUsersTable.$inferInsert> = {};
  if (parsed.data.fullName !== undefined) updates.fullName = parsed.data.fullName;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email;
  if (parsed.data.roleId !== undefined) updates.roleId = parsed.data.roleId;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.password !== undefined) updates.passwordHash = await bcrypt.hash(parsed.data.password, 12);
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No user fields provided to update." });
    return;
  }

  // Phase 7B pilot: snapshot of safe before-values for the activity log.
  let beforeSnapshot: { fullName: string; email: string; roleId: number | null; isActive: boolean } | null = null;

  try {
    const updated = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({
          id: systemUsersTable.id,
          fullName: systemUsersTable.fullName,
          email: systemUsersTable.email,
          roleId: systemUsersTable.roleId,
          isSuperAdmin: systemUsersTable.isSuperAdmin,
          isActive: systemUsersTable.isActive,
        })
        .from(systemUsersTable)
        .where(eq(systemUsersTable.id, id))
        .limit(1);

      if (!target) throw new AdminMutationError(404, "User not found");
      beforeSnapshot = { fullName: target.fullName, email: target.email, roleId: target.roleId, isActive: target.isActive };
      const actor = req.adminUser!;

      if (!actor.isSuperAdmin && target.isSuperAdmin) {
        throw new AdminMutationError(403, "Super Admin accounts can only be modified by another Super Admin.");
      }
      if (id === actor.sub && parsed.data.isActive === false) {
        throw new AdminMutationError(400, "Cannot disable your own account.");
      }
      if (id === actor.sub && parsed.data.roleId !== undefined && parsed.data.roleId !== target.roleId) {
        throw new AdminMutationError(400, "Cannot change your own role.");
      }

      const required: Array<[string, string]> = [];
      if (
        (parsed.data.fullName !== undefined && parsed.data.fullName !== target.fullName) ||
        (parsed.data.email !== undefined && parsed.data.email !== target.email) ||
        parsed.data.password !== undefined
      ) {
        required.push(["adminUsers", "edit"]);
      }
      if (parsed.data.roleId !== undefined && parsed.data.roleId !== target.roleId) {
        required.push(["adminUsers", "assignRole"]);
      }
      if (parsed.data.isActive !== undefined && parsed.data.isActive !== target.isActive) {
        required.push(["adminUsers", "disable"]);
      }
      const missing = required.filter(([moduleKey, actionKey]) =>
        !adminHasPermission(actor, moduleKey, actionKey),
      );
      if (missing.length > 0) {
        throw new AdminMutationError(
          403,
          `Permission denied: ${missing.map(([module, action]) => `${module}.${action}`).join(", ")}`,
        );
      }
      if (parsed.data.roleId != null && parsed.data.roleId !== target.roleId) {
        const [role] = await tx
          .select({ id: rolesTable.id, permissions: rolesTable.permissions })
          .from(rolesTable)
          .where(eq(rolesTable.id, parsed.data.roleId))
          .limit(1);
        if (!role) throw new AdminMutationError(400, "Invalid role ID.");
        if (!permissionsAreWithinAuthority(actor, role.permissions as RolePermissions)) {
          throw new AdminMutationError(403, "Cannot assign permissions beyond your authority.");
        }
      }

      if (target.isSuperAdmin && target.isActive && parsed.data.isActive === false) {
        await tx.execute(sql`select pg_advisory_xact_lock(739451)`);
        const [{ activeSuperAdmins }] = await tx
          .select({ activeSuperAdmins: count() })
          .from(systemUsersTable)
          .where(and(eq(systemUsersTable.isSuperAdmin, true), eq(systemUsersTable.isActive, true)));
        if (Number(activeSuperAdmins) <= 1) {
          throw new AdminMutationError(400, "Cannot remove the final active Super Admin.");
        }
      }

      const [row] = await tx
        .update(systemUsersTable)
        .set(updates)
        .where(eq(systemUsersTable.id, id))
        .returning({ id: systemUsersTable.id, username: systemUsersTable.username, isActive: systemUsersTable.isActive });
      return row;
    });

    logger.info({ targetUserId: id, by: req.adminUser?.sub }, "System user updated");

    // Phase 7B pilot: unified activity log. Only fields present in the patch
    // are recorded; a password change is logged as a boolean flag — never the
    // password or hash. Activation/deactivation get their own action names.
    const snapshot = beforeSnapshot as { fullName: string; email: string; roleId: number | null; isActive: boolean } | null;
    const safeBefore: Record<string, unknown> = {};
    const safeAfter: Record<string, unknown> = {};
    if (parsed.data.fullName !== undefined) { safeBefore["fullName"] = snapshot?.fullName; safeAfter["fullName"] = parsed.data.fullName; }
    if (parsed.data.email !== undefined) { safeBefore["email"] = snapshot?.email; safeAfter["email"] = parsed.data.email; }
    if (parsed.data.roleId !== undefined) { safeBefore["roleId"] = snapshot?.roleId; safeAfter["roleId"] = parsed.data.roleId; }
    if (parsed.data.isActive !== undefined) { safeBefore["isActive"] = snapshot?.isActive; safeAfter["isActive"] = parsed.data.isActive; }
    if (parsed.data.password !== undefined) { safeAfter["passwordChanged"] = true; }
    const isDeactivation = parsed.data.isActive === false && snapshot?.isActive === true;
    const isActivation = parsed.data.isActive === true && snapshot?.isActive === false;
    await logActivity(req, {
      action: isDeactivation ? "deactivate" : isActivation ? "activate" : "update",
      module: "adminUsers",
      entityType: "system_user",
      entityId: id,
      entityLabel: updated.username,
      before: Object.keys(safeBefore).length > 0 ? safeBefore : null,
      after: Object.keys(safeAfter).length > 0 ? safeAfter : null,
      summary: isDeactivation
        ? `Deactivated admin user ${updated.username}`
        : isActivation
          ? `Activated admin user ${updated.username}`
          : `Updated admin user ${updated.username}`,
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof AdminMutationError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

// ─── GET /api/admin/roles ─────────────────────────────────────────────────────
router.get("/admin/roles", requireAdminAuth, requireAdminPermission("roles", "view"), async (_req, res): Promise<void> => {
  const roles = await db.select().from(rolesTable).orderBy(rolesTable.name);
  res.json(roles);
});

// ─── POST /api/admin/roles ────────────────────────────────────────────────────
const CreateRoleBody = z.object({
  name: z.string().min(2),
  description: z.string().nullable().optional(),
  permissions: z.record(z.record(z.boolean())).optional(),
});

router.post("/admin/roles", requireAdminAuth, requireAdminPermission("roles", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateRoleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid" }); return; }

  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "permissions")) {
    if (!requireAllAdminPermissions(req, res, [["roles", "assignPermissions"]])) return;
    const requested = (parsed.data.permissions ?? {}) as RolePermissions;
    if (!permissionsAreWithinAuthority(req.adminUser!, requested)) {
      res.status(403).json({ error: "Cannot assign permissions beyond your authority." });
      return;
    }
  }

  const [role] = await db
    .insert(rolesTable)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      permissions: (parsed.data.permissions ?? {}) as RolePermissions,
    })
    .returning();

  // Phase 7B pilot: unified activity log. Full permission maps are never
  // stored — only the enabled-action count.
  await logActivity(req, {
    action: "create",
    module: "roles",
    entityType: "role",
    entityId: role.id,
    entityLabel: role.name,
    after: {
      name: role.name,
      description: role.description,
      permissionCount: countCatalogPermissions(role.permissions as RolePermissions),
    },
    summary: `Created role ${role.name}`,
  });

  res.status(201).json(role);
});

// ─── PATCH /api/admin/roles/:id ───────────────────────────────────────────────
const UpdateRoleBody = z.object({
  name: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  permissions: z.record(z.record(z.boolean())).optional(),
});

router.patch("/admin/roles/:id", requireAdminAuth, requireAdminPermission("roles", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid role ID" }); return; }

  const parsed = UpdateRoleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid" }); return; }

  const actor = req.adminUser!;
  if (!actor.isSuperAdmin && actor.roleId === id) {
    res.status(403).json({ error: "Cannot modify your own assigned role." });
    return;
  }
  if (parsed.data.permissions !== undefined) {
    if (!requireAllAdminPermissions(req, res, [["roles", "assignPermissions"]])) return;
    const requested = parsed.data.permissions as RolePermissions;
    if (!permissionsAreWithinAuthority(actor, requested)) {
      res.status(403).json({ error: "Cannot assign permissions beyond your authority." });
      return;
    }
  }

  const updates: Partial<typeof rolesTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.permissions !== undefined) updates.permissions = parsed.data.permissions as RolePermissions;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No role fields provided to update." });
    return;
  }

  // Phase 7B pilot: safe before-snapshot for the activity log (read-only;
  // summary-level permission count only, never the full permission map).
  const [existingRole] = await db
    .select({ name: rolesTable.name, description: rolesTable.description, permissions: rolesTable.permissions })
    .from(rolesTable)
    .where(eq(rolesTable.id, id))
    .limit(1);

  const [updated] = await db
    .update(rolesTable)
    .set(updates)
    .where(eq(rolesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Role not found" }); return; }

  await logActivity(req, {
    action: "update",
    module: "roles",
    entityType: "role",
    entityId: updated.id,
    entityLabel: updated.name,
    before: existingRole
      ? {
        name: existingRole.name,
        description: existingRole.description,
        permissionCount: countCatalogPermissions(existingRole.permissions as RolePermissions),
      }
      : null,
    after: {
      name: updated.name,
      description: updated.description,
      permissionCount: countCatalogPermissions(updated.permissions as RolePermissions),
    },
    summary: `Updated role ${updated.name}`,
  });

  res.json(updated);
});

export default router;
