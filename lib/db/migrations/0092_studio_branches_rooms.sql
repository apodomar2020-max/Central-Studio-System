CREATE TABLE "studio_branches" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "code" text GENERATED ALWAYS AS ('BR-' || lpad(id::text, 3, '0')) STORED NOT NULL,
  "address" text,
  "google_maps_link" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "studio_branches_name_unique" ON "studio_branches" USING btree ("name");
--> statement-breakpoint
CREATE UNIQUE INDEX "studio_branches_code_unique" ON "studio_branches" USING btree ("code");
--> statement-breakpoint
CREATE TABLE "studio_rooms" (
  "id" serial PRIMARY KEY NOT NULL,
  "branch_id" integer NOT NULL,
  "name" text NOT NULL,
  "code" text GENERATED ALWAYS AS ('RM-' || lpad(id::text, 3, '0')) STORED NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "studio_rooms_branch_id_studio_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."studio_branches"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "studio_rooms_code_unique" ON "studio_rooms" USING btree ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX "studio_rooms_branch_name_unique" ON "studio_rooms" USING btree ("branch_id", "name");
--> statement-breakpoint
CREATE INDEX "studio_rooms_branch_id_idx" ON "studio_rooms" USING btree ("branch_id");
