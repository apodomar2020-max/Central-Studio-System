CREATE TABLE IF NOT EXISTS "class_pricing_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "single_class_price_egp" integer NOT NULL DEFAULT 300,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO "class_pricing_settings" ("id", "single_class_price_egp")
VALUES (1, 300)
ON CONFLICT ("id") DO NOTHING;
