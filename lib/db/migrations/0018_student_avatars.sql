-- Migration 0018: Student avatars (social profile pictures)
-- Adds avatar tracking so Google (and future provider) profile pictures can be
-- displayed without ever overwriting a manually-uploaded avatar.
--
-- All columns nullable so existing rows remain valid.
--   avatar_url          — effective image to display (manual upload OR synced provider pic)
--   avatar_source       — 'manual' | 'google' (who owns avatar_url); NULL = none yet
--   provider_avatar_url — latest provider picture, always kept in sync even when a
--                         manual avatar is the one displayed.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS avatar_url          text,
  ADD COLUMN IF NOT EXISTS avatar_source       text,
  ADD COLUMN IF NOT EXISTS provider_avatar_url text;
