ALTER TABLE "package_orders" ADD COLUMN "dance_type_restriction_state_snapshot" text;
--> statement-breakpoint
ALTER TABLE "package_orders" ADD CONSTRAINT "package_orders_dance_restriction_snapshot_check" CHECK (
  "dance_type_restriction_state_snapshot" IS NULL
  OR (
    "dance_type_restriction_state_snapshot" = 'restricted'
    AND "allowed_dance_type_ids_snapshot" IS NOT NULL
    AND cardinality("allowed_dance_type_ids_snapshot") > 0
  )
  OR (
    "dance_type_restriction_state_snapshot" = 'unrestricted'
    AND "allowed_dance_type_ids_snapshot" IS NOT NULL
    AND cardinality("allowed_dance_type_ids_snapshot") = 0
  )
);
