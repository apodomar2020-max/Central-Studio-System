/**
 * Security Wave — Mobile SecureStore / Privacy Hardening.
 *
 * The Student JWT (access token) is the single credential that authenticates
 * every request this app makes on the user's behalf. It MUST NOT live in
 * AsyncStorage, which is unencrypted on-device storage (plain files on
 * Android, a plist on iOS) — readable by anything with filesystem access on
 * a rooted/jailbroken device, or recoverable from an unencrypted device
 * backup. This module is the ONLY place the token is written/read/cleared;
 * every call site in the app (bootstrap, login/social-login/OTP-verify,
 * change-password token rotation, logout, SESSION_REVOKED/
 * ACCOUNT_DEACTIVATED handlers) goes through it.
 *
 * Backing store: expo-secure-store (Keychain on iOS, Keystore-backed
 * EncryptedSharedPreferences on Android) — already a declared dependency
 * (used nowhere else yet), so this is a JS-only change: no new native
 * module, no new EAS build required. No custom crypto — SecureStore does
 * the encryption; this module only decides *when* to read/write/clear.
 *
 * No interactive unlock (`requireAuthentication`) is requested — the current
 * product does not gate app launch behind biometrics, and adding it here
 * would silently change that UX. `WHEN_UNLOCKED` (the SecureStore default)
 * matches ordinary background/foreground/relaunch access.
 *
 * ─── Legacy migration ────────────────────────────────────────────────────
 *
 * Older installs may still have a JWT sitting in AsyncStorage under the same
 * "studentToken" key this module used before this change. `getStudentToken()`
 * migrates it ONCE: read the legacy value, write it to SecureStore, read it
 * back to CONFIRM the write actually landed, then delete the legacy key.
 * If the confirm step doesn't match (write silently failed/truncated —
 * platform SecureStore issue, full disk, etc.), this fails SAFE: both the
 * legacy AsyncStorage key and any partial SecureStore value are wiped, and
 * `null` is returned — the app falls back to guest / prompts login rather
 * than risking two divergent copies of a credential existing at once. There
 * is no permanent dual-read fallback after a successful migration — once
 * the legacy key is gone, only SecureStore is ever consulted again.
 */
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SECURE_KEY = "studentToken";

/**
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (iOS-only option; ignored on Android):
 * normal background/foreground/relaunch access — same availability window as
 * SecureStore's default `WHEN_UNLOCKED` — but excludes this item from iCloud
 * Keychain sync and from encrypted device backups, so the token cannot
 * silently reappear on a second device via "restore from backup" or iCloud
 * Keychain. On Android, expo-secure-store already encrypts values with an
 * Android Keystore key that itself never leaves the device (a Keystore key
 * is not exportable, so a restored Auto Backup blob is not decryptable on a
 * different device) — no separate option is needed there; this documents
 * that platform-default behavior rather than changing it.
 */
const IOS_ACCESSIBLE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
/** Same key name as the pre-hardening AsyncStorage storage — deliberate,
 *  so migration is a straight "move this value between stores", not a
 *  key-rename exercise. */
const LEGACY_ASYNCSTORAGE_KEY = "studentToken";

async function migrateLegacyToken(): Promise<string | null> {
  let legacy: string | null = null;
  try {
    legacy = await AsyncStorage.getItem(LEGACY_ASYNCSTORAGE_KEY);
  } catch {
    return null;
  }
  if (!legacy) return null;

  try {
    await SecureStore.setItemAsync(SECURE_KEY, legacy, IOS_ACCESSIBLE_OPTIONS);
    const confirmed = await SecureStore.getItemAsync(SECURE_KEY, IOS_ACCESSIBLE_OPTIONS);
    if (confirmed !== legacy) {
      // Write didn't land as written — fail safe rather than leaving a
      // partial/duplicated secret behind. No token is usable this launch;
      // the user simply logs in again.
      await Promise.allSettled([
        SecureStore.deleteItemAsync(SECURE_KEY),
        AsyncStorage.removeItem(LEGACY_ASYNCSTORAGE_KEY),
      ]);
      return null;
    }
    // Confirmed written — now (and only now) remove the legacy copy so a
    // crash between these two steps can never lose the credential (the
    // legacy key would simply migrate again next launch, which is safe:
    // it just re-writes the same value to SecureStore).
    await AsyncStorage.removeItem(LEGACY_ASYNCSTORAGE_KEY);
    return legacy;
  } catch {
    // Migration itself threw (SecureStore unavailable, etc.) — fail safe:
    // never return a token we couldn't confirm is actually in SecureStore.
    return null;
  }
}

/** Reads the current Student JWT, migrating a legacy AsyncStorage copy on
 *  first read if one is found. Returns null for "not logged in" and for
 *  any storage failure — callers treat both identically (no token). */
export async function getStudentToken(): Promise<string | null> {
  try {
    const token = await SecureStore.getItemAsync(SECURE_KEY, IOS_ACCESSIBLE_OPTIONS);
    if (token) return token;
  } catch {
    // SecureStore read failure — fall through to the legacy path below
    // rather than treating a transient platform error as "definitely no
    // token", since a legacy install might still have one recoverable.
  }
  return migrateLegacyToken();
}

/** Writes/overwrites the Student JWT. Used by every login path (email,
 *  Google, Facebook, OTP verify) and by the change-password token
 *  rotation. */
export async function setStudentToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SECURE_KEY, token, IOS_ACCESSIBLE_OPTIONS);
}

/** Clears the Student JWT from BOTH stores — SecureStore (the canonical
 *  location) and the legacy AsyncStorage key, in case an unmigrated legacy
 *  install logs out before ever calling getStudentToken(). Used by manual
 *  logout, SESSION_REVOKED, ACCOUNT_DEACTIVATED, and the permanent-delete
 *  terminal response — every path that must leave the device with no usable
 *  local credential. */
export async function clearStudentToken(): Promise<void> {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(SECURE_KEY),
    AsyncStorage.removeItem(LEGACY_ASYNCSTORAGE_KEY),
  ]);
}

/** Structural `{ setItem }` adapter matching passwordRecoveryFlow.ts's
 *  `TokenStorage` shape, so persistChangePasswordToken can write through to
 *  SecureStore without that module needing to import SecureStore directly
 *  (keeping it dependency-free / trivially unit-testable, same pattern as
 *  the rest of that file). */
export const secureTokenStorageAdapter: { setItem: (key: string, value: string) => Promise<void> } = {
  setItem: (_key: string, value: string) => setStudentToken(value),
};
