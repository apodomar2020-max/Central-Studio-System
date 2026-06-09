-- Migration 0006: add email_verified to students + create email_otps table

-- Add email_verified column (false by default for existing rows)
ALTER TABLE "students"
  ADD COLUMN IF NOT EXISTS "email_verified" boolean NOT NULL DEFAULT false;

-- OTP codes table
CREATE TABLE IF NOT EXISTS "email_otps" (
  "id" serial PRIMARY KEY NOT NULL,
  "student_id" integer NOT NULL,
  "email" text NOT NULL,
  "code" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
