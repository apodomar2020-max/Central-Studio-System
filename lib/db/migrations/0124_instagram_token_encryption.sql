ALTER TABLE "instagram_token"
  ADD COLUMN "access_token_ciphertext" text,
  ADD COLUMN "access_token_iv" text,
  ADD COLUMN "access_token_auth_tag" text,
  ADD COLUMN "encryption_key_version" text,
  ADD COLUMN "provider_token_revision" text,
  ALTER COLUMN "access_token" DROP NOT NULL;

ALTER TABLE "instagram_token"
  ADD CONSTRAINT "instagram_token_encrypted_envelope_complete"
  CHECK (
    ("access_token_ciphertext" IS NULL
      AND "access_token_iv" IS NULL
      AND "access_token_auth_tag" IS NULL
      AND "encryption_key_version" IS NULL)
    OR
    ("access_token_ciphertext" IS NOT NULL
      AND "access_token_iv" IS NOT NULL
      AND "access_token_auth_tag" IS NOT NULL
      AND "encryption_key_version" IS NOT NULL)
  ),
  ADD CONSTRAINT "instagram_token_material_present"
  CHECK (
    "access_token" IS NOT NULL
    OR
    ("access_token_ciphertext" IS NOT NULL
      AND "access_token_iv" IS NOT NULL
      AND "access_token_auth_tag" IS NOT NULL
      AND "encryption_key_version" IS NOT NULL)
  );
