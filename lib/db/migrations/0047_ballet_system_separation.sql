CREATE TABLE "ballet_instructors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bio" text,
	"photo_url" text,
	"specialties" text[] DEFAULT '{}' NOT NULL,
	"experience_years" integer DEFAULT 0 NOT NULL,
	"rating" real,
	"is_active" boolean DEFAULT true NOT NULL,
	"instagram_url" text,
	"tiktok_url" text,
	"youtube_url" text,
	"teaching_level" text,
	"achievements" text[] DEFAULT '{}' NOT NULL,
	"teaching_philosophy" text,
	"professional_experience" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ballet_classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"instructor_id" integer,
	"class_image_url" text,
	"class_video_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ballet_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_id" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"duration_mins" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ballet_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"level_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ballet_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"monthly_classes" integer NOT NULL,
	"monthly_hours" integer NOT NULL,
	"price_egp" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ballet_performance_opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_title" text NOT NULL,
	"event_type" text NOT NULL,
	"location_name" text,
	"event_date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"requirements" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ballet_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"level_assignment_id" integer,
	"package_id" integer,
	"package_order_id" integer,
	"amount_egp" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ballet_class_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ballet_class_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_id" integer NOT NULL,
	"level_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ballet_package_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" integer NOT NULL,
	"level_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ballet_group_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"schedule_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ballet_applications" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "ballet_schedule_id" integer;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "ballet_class_id" integer;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "ballet_schedule_id" integer;--> statement-breakpoint
ALTER TABLE "ballet_levels" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "ballet_levels" ADD COLUMN "requirements" text;--> statement-breakpoint
ALTER TABLE "ballet_levels" ADD COLUMN "age_min" integer;--> statement-breakpoint
ALTER TABLE "ballet_levels" ADD COLUMN "age_max" integer;--> statement-breakpoint
ALTER TABLE "ballet_assessment_slots" ADD COLUMN "age_min" integer;--> statement-breakpoint
ALTER TABLE "ballet_assessment_slots" ADD COLUMN "age_max" integer;--> statement-breakpoint
ALTER TABLE "ballet_classes" ADD CONSTRAINT "ballet_classes_instructor_id_ballet_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."ballet_instructors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_schedules" ADD CONSTRAINT "ballet_schedules_class_id_ballet_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."ballet_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_groups" ADD CONSTRAINT "ballet_groups_level_id_ballet_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."ballet_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_payments" ADD CONSTRAINT "ballet_payments_application_id_ballet_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."ballet_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_payments" ADD CONSTRAINT "ballet_payments_level_assignment_id_ballet_level_assignments_id_fk" FOREIGN KEY ("level_assignment_id") REFERENCES "public"."ballet_level_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_payments" ADD CONSTRAINT "ballet_payments_package_id_ballet_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."ballet_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_payments" ADD CONSTRAINT "ballet_payments_package_order_id_package_orders_id_fk" FOREIGN KEY ("package_order_id") REFERENCES "public"."package_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_class_groups" ADD CONSTRAINT "ballet_class_groups_class_id_ballet_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."ballet_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_class_groups" ADD CONSTRAINT "ballet_class_groups_group_id_ballet_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ballet_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_class_levels" ADD CONSTRAINT "ballet_class_levels_class_id_ballet_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."ballet_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_class_levels" ADD CONSTRAINT "ballet_class_levels_level_id_ballet_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."ballet_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_package_levels" ADD CONSTRAINT "ballet_package_levels_package_id_ballet_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."ballet_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_package_levels" ADD CONSTRAINT "ballet_package_levels_level_id_ballet_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."ballet_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_group_schedules" ADD CONSTRAINT "ballet_group_schedules_group_id_ballet_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ballet_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballet_group_schedules" ADD CONSTRAINT "ballet_group_schedules_schedule_id_ballet_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."ballet_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ballet_class_groups_class_group_unique" ON "ballet_class_groups" USING btree ("class_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ballet_class_levels_class_level_unique" ON "ballet_class_levels" USING btree ("class_id","level_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ballet_package_levels_package_level_unique" ON "ballet_package_levels" USING btree ("package_id","level_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ballet_group_schedules_group_schedule_unique" ON "ballet_group_schedules" USING btree ("group_id","schedule_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_ballet_schedule_id_ballet_schedules_id_fk" FOREIGN KEY ("ballet_schedule_id") REFERENCES "public"."ballet_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_ballet_class_id_ballet_classes_id_fk" FOREIGN KEY ("ballet_class_id") REFERENCES "public"."ballet_classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_ballet_schedule_id_ballet_schedules_id_fk" FOREIGN KEY ("ballet_schedule_id") REFERENCES "public"."ballet_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Manual data migration: collapse ballet application statuses to the new
-- 7-value set. "submitted" and "pendingAssessment" merge into "pending";
-- "activeBallet" is renamed to "active". accepted / rejected / needsFollowUp /
-- assignedToLevel / cancelled are unchanged.
UPDATE "ballet_applications" SET "status" = 'pending' WHERE "status" IN ('submitted', 'pendingAssessment');--> statement-breakpoint
UPDATE "ballet_applications" SET "status" = 'active' WHERE "status" = 'activeBallet';