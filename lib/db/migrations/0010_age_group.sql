-- Migration 0010: Add age_group to classes
--
-- Adds an age_group column to the classes table so the mobile app can filter
-- classes by Kids / Teens / Adults. All existing rows receive 'Adults' as the
-- default value (matches the previous hardcoded behaviour in apiAdapters.ts).
--
-- Statement is idempotent: IF NOT EXISTS prevents errors on replay.

ALTER TABLE "classes" ADD COLUMN IF NOT EXISTS "age_group" text NOT NULL DEFAULT 'Adults';
