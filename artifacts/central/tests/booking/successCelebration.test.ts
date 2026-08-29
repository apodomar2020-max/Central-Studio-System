import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const celebration = readFileSync(new URL("../../components/success/SuccessCelebration.tsx", import.meta.url), "utf8");
const confirmation = readFileSync(new URL("../../app/booking/confirmation.tsx", import.meta.url), "utf8");
const onboarding = readFileSync(new URL("../../app/onboarding/success.tsx", import.meta.url), "utf8");

test("shared success celebration contains exactly 24 animated pieces", () => {
  assert.match(celebration, /Array\.from\(\{ length: 24 \}/);
  assert.match(celebration, /Animated\.loop/);
});

test("shared success feedback includes one success haptic and icon pop", () => {
  assert.match(celebration, /Haptics\.NotificationFeedbackType\.Success/);
  assert.match(celebration, /Animated\.spring\(pop/);
});

test("booking and onboarding success screens reuse the same celebration", () => {
  for (const screen of [confirmation, onboarding]) {
    assert.match(screen, /<SuccessConfetti \/>/);
    assert.match(screen, /useSuccessPopHaptic\(\)/);
  }
});

test("booking success does not use the onboarding intro video", () => {
  assert.doesNotMatch(confirmation, /StageVideo|EntroVideo|expo-video/);
});
