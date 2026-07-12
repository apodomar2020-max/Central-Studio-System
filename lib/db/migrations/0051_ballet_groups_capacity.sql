-- Migration 0051: Ballet Groups Capacity (Phase A / P0-6)
--
-- Adds a nullable capacity to ballet_groups. Null means uncapped (no limit
-- enforced); a set value is enforced by POST /admin/ballet/applications/:id/
-- assign-group against a live count of active ballet_level_assignments rows
-- pointed at the group. No backfill needed — every existing group simply
-- reads as uncapped until an admin sets a value.
ALTER TABLE "ballet_groups" ADD COLUMN "capacity" integer;
