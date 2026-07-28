-- Phase B: canonical general Studio package dance-type restrictions.
-- Zero rows for a package means unrestricted. Legacy allowed_dance_types remains.

CREATE TABLE "price_package_dance_types" (
  "package_id" integer NOT NULL,
  "dance_type_id" integer NOT NULL,
  CONSTRAINT "price_package_dance_types_package_id_dance_type_id_pk"
    PRIMARY KEY ("package_id", "dance_type_id"),
  CONSTRAINT "price_package_dance_types_package_id_price_packages_id_fk"
    FOREIGN KEY ("package_id") REFERENCES "price_packages"("id") ON DELETE CASCADE,
  CONSTRAINT "price_package_dance_types_dance_type_id_dance_types_id_fk"
    FOREIGN KEY ("dance_type_id") REFERENCES "dance_types"("id") ON DELETE RESTRICT
);

CREATE INDEX "price_package_dance_types_dance_type_id_idx"
  ON "price_package_dance_types" ("dance_type_id");
