ALTER TABLE "schedules" ADD COLUMN "branch_id" integer;
--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "room_id" integer;
--> statement-breakpoint
ALTER TABLE "ballet_schedules" ADD COLUMN "branch_id" integer;
--> statement-breakpoint
ALTER TABLE "ballet_schedules" ADD COLUMN "room_id" integer;
--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_branch_id_studio_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."studio_branches"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_room_id_studio_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."studio_rooms"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ballet_schedules" ADD CONSTRAINT "ballet_schedules_branch_id_studio_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."studio_branches"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ballet_schedules" ADD CONSTRAINT "ballet_schedules_room_id_studio_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."studio_rooms"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "schedules_branch_id_idx" ON "schedules" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX "schedules_room_id_idx" ON "schedules" USING btree ("room_id");
--> statement-breakpoint
CREATE INDEX "ballet_schedules_branch_id_idx" ON "ballet_schedules" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX "ballet_schedules_room_id_idx" ON "ballet_schedules" USING btree ("room_id");
