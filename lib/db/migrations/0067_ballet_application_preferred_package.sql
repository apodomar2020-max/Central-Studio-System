ALTER TABLE ballet_applications
  ADD COLUMN IF NOT EXISTS preferred_package_id integer REFERENCES ballet_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ballet_applications_preferred_package_idx
  ON ballet_applications(preferred_package_id);
