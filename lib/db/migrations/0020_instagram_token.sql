-- Instagram token storage — single-row table for persisted long-lived token
-- Survives Railway restarts; auto-refreshed every 30 days by the API server.

CREATE TABLE IF NOT EXISTS "instagram_token" (
  "id"           integer PRIMARY KEY DEFAULT 1,
  "access_token" text NOT NULL,
  "refreshed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "instagram_token_single_row" CHECK ("id" = 1)
);
