-- Installation-scoped authorization for offline Push-device deactivation.
-- Raw secrets are returned once to authenticated registrations and are never
-- stored here. Historical rows remain valid and receive a hash on their next
-- authenticated registration.
ALTER TABLE "notification_devices"
  ADD COLUMN IF NOT EXISTS "unregister_secret_hash" text;

-- Manual rollback (only after rolling back all application versions that read
-- this field):
-- ALTER TABLE "notification_devices" DROP COLUMN IF EXISTS "unregister_secret_hash";
