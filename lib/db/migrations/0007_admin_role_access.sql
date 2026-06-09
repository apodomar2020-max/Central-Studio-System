-- Migration 0007: Admin Role Access System
-- Creates system_users and roles tables for the Admin Dashboard login system.
-- These are entirely separate from the students (mobile app) users.

CREATE TABLE IF NOT EXISTS "roles" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL UNIQUE,
  "description" text,
  "permissions" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "system_users" (
  "id" serial PRIMARY KEY NOT NULL,
  "username" text NOT NULL UNIQUE,
  "email" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "full_name" text NOT NULL,
  "role_id" integer REFERENCES "roles"("id") ON DELETE SET NULL,
  "is_super_admin" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Seed the default Super Admin account.
-- Password: Admin@Central2024  (bcrypt hash below)
-- IMPORTANT: Change this password immediately after first login!
-- Hash generated with: bcrypt.hash("Admin@Central2024", 12)
INSERT INTO "system_users" ("username", "email", "password_hash", "full_name", "is_super_admin", "is_active")
VALUES (
  'superadmin',
  'admin@centralstudio.com',
  '$2a$12$5z.swKoyQNWQ9OGnGBjYSOh7pLev3TDh8bFqOfKEBcaKJNQ9YzvRG',
  'Super Admin',
  true,
  true
)
ON CONFLICT ("username") DO NOTHING;
