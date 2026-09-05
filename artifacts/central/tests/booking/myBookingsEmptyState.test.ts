import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync(new URL("../../app/(tabs)/bookings.tsx", import.meta.url), "utf8");
const balletClasses = readFileSync(new URL("../../app/ballet/classes.tsx", import.meta.url), "utf8");
const animation = JSON.parse(readFileSync(new URL("../../assets/animations/calendar-error.json", import.meta.url), "utf8")) as {
  w?: number;
  h?: number;
  layers?: unknown[];
};

test("My Bookings empty state uses the supplied looping Lottie animation", () => {
  assert.match(screen, /from "lottie-react-native"/);
  assert.match(screen, /calendar-error\.json/);
  assert.match(screen, /<LottieView source=\{EMPTY_BOOKINGS_ANIMATION\} autoPlay loop/);
  assert.match(screen, />No upcoming bookings<\/Text>/);
  assert.equal(animation.w, 140);
  assert.equal(animation.h, 140);
  assert.ok((animation.layers?.length ?? 0) > 0);
});

test("Ballet Classes reuses the animation and renders its empty action as a primary button", () => {
  assert.match(balletClasses, /calendar-error\.json/);
  assert.match(balletClasses, /<LottieView source=\{EMPTY_CLASSES_ANIMATION\} autoPlay loop/);
  assert.match(balletClasses, /style=\{s\.emptyActionButton\}/);
  assert.match(balletClasses, /backgroundColor: CYAN/);
  assert.match(balletClasses, /actionLabel: "Application Status"/);
});
