CREATE TABLE IF NOT EXISTS "studio_room_reservations" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "reservation_type" text NOT NULL,
  "branch_id" integer NOT NULL,
  "room_id" integer NOT NULL,
  "date" date NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "description" text,
  "organizer_name" text,
  "organizer_contact" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by_user_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "studio_room_reservations_branch_id_studio_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."studio_branches"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "studio_room_reservations_room_id_studio_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."studio_rooms"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "studio_room_reservations_created_by_user_id_system_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."system_users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_reservations_room_date_status_idx" ON "studio_room_reservations" USING btree ("room_id", "date", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_reservations_branch_date_idx" ON "studio_room_reservations" USING btree ("branch_id", "date");
