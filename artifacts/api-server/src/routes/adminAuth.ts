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
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, systemUsersTable, rolesTable } from "@workspace/db";
import type { RolePermissions } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── JWT helpers ──────────────────────────────────────────────────────────────

const JWT_SECRET = process.env["ADMIN_JWT_SECRET"] ?? "dev-admin-secret-change-in-production";
const JWT_EXPIRES_IN = "8h"; // admin session lasts 8 hours

interface AdminTokenPayload {
  sub: number;         // system_user.id
  username: string;
  isSuperAdmin: boolean;
  roleId: number | null;
}

function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyAdminToken(token: string): AdminTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AdminTokenPayload;
}

// ─── Admin auth middleware ─────────────────────────────────────────────────────
// Attach to any route that requires a logged-in admin user.

export interface AdminRequest extends Request {
  adminUser?: AdminTokenPayload;
}

export function requireAdminAuth(req: AdminRequest, res: Response, next: NextFunction): void {
  const token = req.headers["x-admin-token"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Admin token required" });
    return;
  }
  try {
    req.adminUser = verifyAdminToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired admin token" });
  }
}

export function requireSuperAdmin(req: AdminRequest, res: Response, next: NextFunction): void {
  if (!req.adminUser?.isSuperAdmin) {
    res.status(403).json({ error: "Super Admin access required" });
    return;
  }
  next();
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
    res.status(401).json({ error: "Invalid credentials or account is inactive" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    logger.warn({ username }, "Failed admin login attempt");
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

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      roleId: user.roleId,
      role: roleData ? { id: roleData.id, name: roleData.name, permissions: roleData.permissions } : null,
    },
  });
});

// ─── GET /api/admin/auth/me ───────────────────────────────────────────────────
router.get("/admin/auth/me", requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(systemUsersTable)
    .where(eq(systemUsersTable.id, req.adminUser!.sub));

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Account not found or inactive" });
    return;
  }

  let roleData = null;
  if (user.roleId) {
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, user.roleId));
    roleData = role ?? null;
  }

  res.json({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
    roleId: user.roleId,
    role: roleData ? { id: roleData.id, name: roleData.name, permissions: roleData.permissions } : null,
  });
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
router.get("/admin/users", requireAdminAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
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

router.post("/admin/users", requireAdminAuth, requireSuperAdmin, async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { username, email, fullName, password, roleId } = parsed.data;

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

  logger.info({ newUserId: newUser.id }, "System user created by Super Admin");
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

router.patch("/admin/users/:id", requireAdminAuth, requireSuperAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }); return; }

  const updates: Partial<typeof systemUsersTable.$inferInsert> = {};
  if (parsed.data.fullName !== undefined) updates.fullName = parsed.data.fullName;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email;
  if (parsed.data.roleId !== undefined) updates.roleId = parsed.data.roleId;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.password !== undefined) updates.passwordHash = await bcrypt.hash(parsed.data.password, 12);

  const [updated] = await db
    .update(systemUsersTable)
    .set(updates)
    .where(eq(systemUsersTable.id, id))
    .returning({ id: systemUsersTable.id, username: systemUsersTable.username, isActive: systemUsersTable.isActive });

  if (!updated) { res.status(404).json({ error: "User not found" }); return; }

  logger.info({ targetUserId: id, by: req.adminUser?.sub }, "System user updated");
  res.json(updated);
});

// ─── GET /api/admin/roles ─────────────────────────────────────────────────────
router.get("/admin/roles", requireAdminAuth, async (_req, res): Promise<void> => {
  const roles = await db.select().from(rolesTable).orderBy(rolesTable.name);
  res.json(roles);
});

// ─── POST /api/admin/roles ────────────────────────────────────────────────────
const CreateRoleBody = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  permissions: z.record(z.object({
    view: z.boolean().default(false),
    create: z.boolean().default(false),
    edit: z.boolean().default(false),
    delete: z.boolean().default(false),
  })).optional(),
});

router.post("/admin/roles", requireAdminAuth, requireSuperAdmin, async (req, res): Promise<void> => {
  const parsed = CreateRoleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid" }); return; }

  const [role] = await db
    .insert(rolesTable)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      permissions: (parsed.data.permissions ?? {}) as RolePermissions,
    })
    .returning();

  res.status(201).json(role);
});

// ─── PATCH /api/admin/roles/:id ───────────────────────────────────────────────
router.patch("/admin/roles/:id", requireAdminAuth, requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid role ID" }); return; }

  const parsed = CreateRoleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid" }); return; }

  const [updated] = await db
    .update(rolesTable)
    .set({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      permissions: (parsed.data.permissions ?? {}) as RolePermissions,
    })
    .where(eq(rolesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Role not found" }); return; }
  res.json(updated);
});

export default router;
