-- Task Group 2: instructor profile CMS fields.
-- teaching_philosophy: free text. professional_experience: text[] (one row each).
-- Both additive + idempotent so existing instructors stay valid.
ALTER TABLE "instructors" ADD COLUMN IF NOT EXISTS "teaching_philosophy" text;
ALTER TABLE "instructors" ADD COLUMN IF NOT EXISTS "professional_experience" text[] NOT NULL DEFAULT '{}';
