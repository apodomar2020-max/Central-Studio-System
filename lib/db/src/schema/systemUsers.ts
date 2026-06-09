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
 * permissions is a JSON object: { [module]: { view, create, edit, delete } }
 * Example:
 * {
 *   "classes": { "view": true, "create": true, "edit": true, "delete": false },
 *   "students": { "view": true, "create": false, "edit": false, "delete": false }
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

// The list of all modules that can have permissions assigned
export const ADMIN_MODULES = [
  "dashboard",
  "instructors",
  "classes",
  "schedules",
  "packages",
  "bookings",
  "students",
  "offers",
  "notifications",
  "marketing",
  "package_orders",
  "attendance",
  "hero_items",
  "system_users",
] as const;

export type AdminModule = (typeof ADMIN_MODULES)[number];

export interface ModulePermissions {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export type RolePermissions = Partial<Record<AdminModule, ModulePermissions>>;
