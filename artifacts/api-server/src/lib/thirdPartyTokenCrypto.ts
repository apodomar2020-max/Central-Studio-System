import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION_RE = /^[A-Za-z0-9._-]{1,64}$/;

export const THIRD_PARTY_TOKEN_ENCRYPTION_CONTEXT = "central-studio:third-party-token:v1";

export interface EncryptedTokenEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}

export interface TokenEncryptionKeyring {
  currentVersion: string;
  keys: ReadonlyMap<string, Buffer>;
}

export class TokenEncryptionConfigurationError extends Error {
  constructor(message = "Third-party token encryption is not configured correctly.") {
    super(message);
    this.name = "TokenEncryptionConfigurationError";
  }
}

export class TokenDecryptionError extends Error {
  constructor() {
    super("Third-party token could not be decrypted.");
    this.name = "TokenDecryptionError";
  }
}

function decodeKey(value: string): Buffer {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new TokenEncryptionConfigurationError();
  }
  const key = Buffer.from(normalized, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== normalized) {
    throw new TokenEncryptionConfigurationError();
  }
  return key;
}

function decodeEnvelopePart(value: string, expectedBytes?: number): Buffer {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new TokenDecryptionError();
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (expectedBytes !== undefined && decoded.length !== expectedBytes)) {
    throw new TokenDecryptionError();
  }
  return decoded;
}

/**
 * Build a versioned keyring from API-only environment variables.
 *
 * THIRD_PARTY_TOKEN_ENCRYPTION_KEY is the current 32-byte base64 key.
 * THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION names that key (for example v1).
 * THIRD_PARTY_TOKEN_PREVIOUS_ENCRYPTION_KEYS is an optional JSON object whose
 * values are decrypt-only base64 keys, enabling a staged key rotation.
 */
export function tokenEncryptionKeyringFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TokenEncryptionKeyring {
  const currentValue = env["THIRD_PARTY_TOKEN_ENCRYPTION_KEY"]?.trim();
  const currentVersion = env["THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION"]?.trim();
  if (!currentValue || !currentVersion || !VERSION_RE.test(currentVersion)) {
    throw new TokenEncryptionConfigurationError();
  }

  const keys = new Map<string, Buffer>();
  const previousJson = env["THIRD_PARTY_TOKEN_PREVIOUS_ENCRYPTION_KEYS"]?.trim();
  if (previousJson) {
    let previous: unknown;
    try {
      previous = JSON.parse(previousJson);
    } catch {
      throw new TokenEncryptionConfigurationError();
    }
    if (!previous || typeof previous !== "object" || Array.isArray(previous)) {
      throw new TokenEncryptionConfigurationError();
    }
    for (const [version, value] of Object.entries(previous as Record<string, unknown>)) {
      if (!VERSION_RE.test(version) || typeof value !== "string" || version === currentVersion) {
        throw new TokenEncryptionConfigurationError();
      }
      keys.set(version, decodeKey(value));
    }
  }

  keys.set(currentVersion, decodeKey(currentValue));
  return { currentVersion, keys };
}

function aad(context: string, keyVersion: string): Buffer {
  return Buffer.from(`${THIRD_PARTY_TOKEN_ENCRYPTION_CONTEXT}\n${context}\n${keyVersion}`, "utf8");
}

export function encryptThirdPartyToken(
  plaintext: string,
  context: string,
  keyring: TokenEncryptionKeyring,
): EncryptedTokenEnvelope {
  if (!plaintext || !context) throw new TokenEncryptionConfigurationError();
  const key = keyring.keys.get(keyring.currentVersion);
  if (!key || key.length !== KEY_BYTES || !VERSION_RE.test(keyring.currentVersion)) {
    throw new TokenEncryptionConfigurationError();
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(aad(context, keyring.currentVersion));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: keyring.currentVersion,
  };
}

export function decryptThirdPartyToken(
  envelope: EncryptedTokenEnvelope,
  context: string,
  keyring: TokenEncryptionKeyring,
): string {
  try {
    if (!VERSION_RE.test(envelope.keyVersion) || !context) throw new TokenDecryptionError();
    const key = keyring.keys.get(envelope.keyVersion);
    if (!key || key.length !== KEY_BYTES) throw new TokenDecryptionError();
    const ciphertext = decodeEnvelopePart(envelope.ciphertext);
    if (ciphertext.length === 0) throw new TokenDecryptionError();
    const iv = decodeEnvelopePart(envelope.iv, IV_BYTES);
    const authTag = decodeEnvelopePart(envelope.authTag, AUTH_TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(aad(context, envelope.keyVersion));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof TokenEncryptionConfigurationError) throw error;
    throw new TokenDecryptionError();
  }
}
