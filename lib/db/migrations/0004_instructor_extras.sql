-- Migration: add social media links, teaching_level, achievements to instructors
ALTER TABLE "instructors" ADD COLUMN IF NOT EXISTS "instagram_url" text;
ALTER TABLE "instructors" ADD COLUMN IF NOT EXISTS "tiktok_url" text;
ALTER TABLE "instructors" ADD COLUMN IF NOT EXISTS "youtube_url" text;
ALTER TABLE "instructors" ADD COLUMN IF NOT EXISTS "teaching_level" text;
ALTER TABLE "instructors" ADD COLUMN IF NOT EXISTS "achievements" text[] NOT NULL DEFAULT '{}';
