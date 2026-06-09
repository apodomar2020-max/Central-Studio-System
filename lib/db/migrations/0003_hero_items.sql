CREATE TABLE IF NOT EXISTS "hero_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "image_url" text NOT NULL,
  "tagline" text,
  "title" text NOT NULL,
  "button_text" text NOT NULL DEFAULT 'Get Started',
  "button_route" text NOT NULL DEFAULT '/(tabs)/classes',
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL
);
