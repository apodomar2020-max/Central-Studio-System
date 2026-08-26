import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  decryptThirdPartyToken,
  encryptThirdPartyToken,
  TokenDecryptionError,
  TokenEncryptionConfigurationError,
  tokenEncryptionKeyringFromEnv,
} from "./thirdPartyTokenCrypto";

const CONTEXT = "instagram_access_token";

function base64Key(): string {
  return randomBytes(32).toString("base64");
}

test("third-party token encryption round-trips without retaining plaintext", () => {
  const plaintext = "long-lived-provider-token-sensitive-value";
  const keyring = tokenEncryptionKeyringFromEnv({
    THIRD_PARTY_TOKEN_ENCRYPTION_KEY: base64Key(),
    THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION: "v7",
  });
  const envelope = encryptThirdPartyToken(plaintext, CONTEXT, keyring);

  assert.equal(envelope.keyVersion, "v7");
  assert.equal(JSON.stringify(envelope).includes(plaintext), false);
  assert.equal(decryptThirdPartyToken(envelope, CONTEXT, keyring), plaintext);
});

test("tampered or malformed ciphertext fails with a generic safe error", () => {
  const keyring = tokenEncryptionKeyringFromEnv({
    THIRD_PARTY_TOKEN_ENCRYPTION_KEY: base64Key(),
    THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION: "v1",
  });
  const envelope = encryptThirdPartyToken("sensitive-token", CONTEXT, keyring);

  assert.throws(
    () => decryptThirdPartyToken({ ...envelope, authTag: Buffer.alloc(16, 1).toString("base64") }, CONTEXT, keyring),
    (error: unknown) => error instanceof TokenDecryptionError && !error.message.includes("sensitive-token"),
  );
  assert.throws(
    () => decryptThirdPartyToken({ ...envelope, iv: "not-base64" }, CONTEXT, keyring),
    TokenDecryptionError,
  );
});

test("wrong key and wrong encryption context both fail closed", () => {
  const keyring = tokenEncryptionKeyringFromEnv({
    THIRD_PARTY_TOKEN_ENCRYPTION_KEY: base64Key(),
    THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION: "v1",
  });
  const wrongKeyring = tokenEncryptionKeyringFromEnv({
    THIRD_PARTY_TOKEN_ENCRYPTION_KEY: base64Key(),
    THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION: "v1",
  });
  const envelope = encryptThirdPartyToken("sensitive-token", CONTEXT, keyring);

  assert.throws(() => decryptThirdPartyToken(envelope, CONTEXT, wrongKeyring), TokenDecryptionError);
  assert.throws(() => decryptThirdPartyToken(envelope, "other_provider", keyring), TokenDecryptionError);
});

test("previous version remains decryptable while all new writes use current version", () => {
  const previousKey = base64Key();
  const oldKeyring = tokenEncryptionKeyringFromEnv({
    THIRD_PARTY_TOKEN_ENCRYPTION_KEY: previousKey,
    THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION: "v1",
  });
  const oldEnvelope = encryptThirdPartyToken("old-token", CONTEXT, oldKeyring);
  const rotatingKeyring = tokenEncryptionKeyringFromEnv({
    THIRD_PARTY_TOKEN_ENCRYPTION_KEY: base64Key(),
    THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION: "v2",
    THIRD_PARTY_TOKEN_PREVIOUS_ENCRYPTION_KEYS: JSON.stringify({ v1: previousKey }),
  });

  assert.equal(decryptThirdPartyToken(oldEnvelope, CONTEXT, rotatingKeyring), "old-token");
  assert.equal(encryptThirdPartyToken("new-token", CONTEXT, rotatingKeyring).keyVersion, "v2");
});

test("missing, malformed, or non-32-byte production key configuration is rejected", () => {
  assert.throws(() => tokenEncryptionKeyringFromEnv({}), TokenEncryptionConfigurationError);
  assert.throws(
    () => tokenEncryptionKeyringFromEnv({
      THIRD_PARTY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64"),
      THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION: "v1",
    }),
    TokenEncryptionConfigurationError,
  );
  assert.throws(
    () => tokenEncryptionKeyringFromEnv({
      THIRD_PARTY_TOKEN_ENCRYPTION_KEY: base64Key(),
      THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION: "bad version",
    }),
    TokenEncryptionConfigurationError,
  );
});
