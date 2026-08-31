/**
 * Canonical Account Phone Domain — regression guard for the two Mobile
 * write surfaces (Complete Profile, Edit Profile), proving both now share
 * the SAME validator/normalizer from @workspace/api-zod instead of each
 * carrying its own private rule (Complete Profile's old strict inline
 * regex, Edit Profile's old weak >=7-digit rule).
 *
 * app/auth/complete-profile.tsx and app/edit-profile.tsx are Expo Router
 * screens (JSX, react-native imports) that cannot be imported into a plain
 * Node test process — this follows the repo's established source-assertion
 * convention (see artifacts/api-server/src/routes/bookingPriceBinding.test.ts).
 * This file lives under tests/, not app/, per the Expo Router test-hygiene
 * convention established earlier in this repo's history.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const COMPLETE_PROFILE_SCREEN = "artifacts/central/app/auth/complete-profile.tsx";
const EDIT_PROFILE_SCREEN = "artifacts/central/app/edit-profile.tsx";

for (const path of [COMPLETE_PROFILE_SCREEN, EDIT_PROFILE_SCREEN]) {
  test(`${path}: imports validateAccountPhone from the shared @workspace/api-zod domain`, () => {
    const source = read(path);
    assert.match(source, /import \{[^}]*validateAccountPhone[^}]*\} from "@workspace\/api-zod"/);
  });

  test(`${path}: submits the canonical phone value, never raw local input`, () => {
    const source = read(path);
    assert.match(source, /phone:\s*phoneValidation\.canonical/, "expected the PATCH body to send phoneValidation.canonical");
  });

  test(`${path}: a PHONE_ALREADY_IN_USE conflict is caught and surfaced with the approved message`, () => {
    const source = read(path);
    assert.match(source, /PHONE_ALREADY_IN_USE/);
    assert.match(source, /This phone number is already associated with another account\./);
  });
}

test("edit-profile.tsx: the old weak >=7-digit validPhone() rule is gone", () => {
  const source = read(EDIT_PROFILE_SCREEN);
  assert.equal(/function validPhone/.test(source), false, "the private, weaker phone validator must be removed — Edit Profile now shares Complete Profile's exact rule");
});

test("edit-profile.tsx: displays the canonical API value in the familiar local form", () => {
  const source = read(EDIT_PROFILE_SCREEN);
  assert.match(source, /formatAccountPhoneLocal\(user\?\.phone\)/);
});

test("complete-profile.tsx: the old inline 5-line regex ladder is gone", () => {
  const source = read(COMPLETE_PROFILE_SCREEN);
  assert.equal(/Phone number must contain digits only\./.test(source), false, "the old private regex-ladder messages must be gone — both screens now share one rule/one set of messages");
});
