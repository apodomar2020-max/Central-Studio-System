import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * System users — the people who log into the Admin Dashboard.
 * These are NOT the same as students (mobile app users).
 *
 * roleId references the roles table. NULL roleId means no permissions.
 * Super Admin is identified by isSuperAdmin = true — they bypass all permission checks.
 */
export const systemUsersTable = pgTable("system_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  roleId: integer("role_id"),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

/**
 * Roles — named sets of permissions.
 * e.g. "Receptionist", "Instructor Coordinator", "Marketing Manager"
 *
 * permissions is a JSON object: { [module]: { [action]: boolean } }
 * Example:
 * {
 *   "classes": { "view": true, "edit": true, "mediaManage": true },
 *   "reports": { "view": true, "exportPdf": false }
 * }
 */
export const rolesTable = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  permissions: jsonb("permissions").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export type SystemUser = typeof systemUsersTable.$inferSelect;
export type Role = typeof rolesTable.$inferSelect;

// The browser-safe catalog lives in @workspace/api-zod. The database keeps this
// deliberately open so new action keys do not require schema migrations.
export type ModulePermissions = Partial<Record<string, boolean>>;
export type RolePermissions = Partial<Record<string, ModulePermissions>>;
