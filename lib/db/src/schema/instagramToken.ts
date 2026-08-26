import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";

export const instagramToken = pgTable("instagram_token", {
  id:                    integer("id").primaryKey().default(1),
  // Legacy bootstrap column. The API migrates any existing plaintext value
  // online, then nulls it. New writes use only the authenticated envelope.
  accessToken:           text("access_token"),
  accessTokenCiphertext: text("access_token_ciphertext"),
  accessTokenIv:         text("access_token_iv"),
  accessTokenAuthTag:    text("access_token_auth_tag"),
  encryptionKeyVersion: text("encryption_key_version"),
  providerTokenRevision: text("provider_token_revision"),
  refreshedAt:           timestamp("refreshed_at", { withTimezone: true }).defaultNow().notNull(),
});
