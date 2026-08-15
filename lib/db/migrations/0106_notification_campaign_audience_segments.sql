-- Additive migration 0106: Notifications Wave 3 — Manual Push Campaign
-- audience segments.
--
-- Wave 2 (migration 0104) shipped notification_campaigns.audience_type /
-- audience_config already shaped to hold any audience the resolver
-- eventually supports — no new column is needed for the seven Wave 3
-- segments. The ONLY schema change required is widening the existing
-- CHECK constraint that currently allows just 'all', so campaigns can be
-- created with the six new segment types (a seventh, 'all_members', is
-- the Wave 3 replacement name for the original 'all' value — both remain
-- permanently valid so any existing campaign row is never invalidated).
--
-- No column added, no column dropped, no existing row touched, no data
-- rewritten. Purely a constraint replacement — the same additive pattern
-- already used by every other project "_check" constraint update.

ALTER TABLE "notification_campaigns"
  DROP CONSTRAINT IF EXISTS "notification_campaigns_audience_type_check";

ALTER TABLE "notification_campaigns"
  ADD CONSTRAINT "notification_campaigns_audience_type_check"
  CHECK ("audience_type" in (
    'all',
    'all_members',
    'specific_members',
    'students',
    'parents',
    'ballet_families',
    'class_participants',
    'package_holders'
  ));

-- Rollback (not executed by this migration; documented for operator reference):
--   ALTER TABLE "notification_campaigns" DROP CONSTRAINT "notification_campaigns_audience_type_check";
--   ALTER TABLE "notification_campaigns" ADD CONSTRAINT "notification_campaigns_audience_type_check" CHECK ("audience_type" in ('all'));
-- (Only safe to roll back if no row has since been created with a Wave 3
-- audience_type value — rolling back with such a row present would violate
-- the restored narrower constraint.)
