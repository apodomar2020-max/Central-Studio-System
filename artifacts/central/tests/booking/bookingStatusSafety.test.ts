import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { mapApiStatusToLocal, isSelfCancellableBookingStatus } from "../../utils/bookingStatus";
import { isBookingSelfCancellableClientSide } from "../../utils/bookingCancellationEligibility";
import { loadStatusUI, nodes } from "./bookingStatusHarness";

const canonical = ["pending", "confirmed", "rejected", "cancelled", "attended", "completed", "attendance_reversed"];
const invalid: unknown[] = [undefined, null, "", "future_status", "unknown", "toString", "constructor", "__proto__", "hasOwnProperty", 0, 1, false, true, {}, [], ["confirmed"], new String("confirmed"), { toString: () => "confirmed" }, Symbol("confirmed")];
const known = [...canonical, "noShow", "no_show", "pendingPayment"];
const fixture = (status: unknown) => ({ id: "own-booking", className: "Afro", date: "2026-10-23", occurrenceDate: "2026-10-23", scheduleStartTime: "21:15", time: "21:15", bookingStatus: status, paymentStatus: "paid", duration: "75 min" });

for (const status of known) test(`status policy preserves canonical/legacy mapping and self-cancellation: ${status}`, () => {
  const local = mapApiStatusToLocal(status);
  assert.equal(local, status === "attendance_reversed" ? "unknown" : status === "no_show" ? "noShow" : status === "pendingPayment" ? "pending" : status);
  assert.equal(isSelfCancellableBookingStatus(local), ["pending", "confirmed"].includes(local));
});

test("malformed/missing/prototype status values stay neutral without coercion or inherited-property access", () => {
  for (const value of invalid) {
    assert.equal(mapApiStatusToLocal(value), "unknown");
    assert.equal(isSelfCancellableBookingStatus(value), false);
  }
});

for (const os of ["ios", "android"]) {
  test(`${os}: every recognized local card state preserves its existing label and color; unsupported inputs are neutral`, () => {
    const { module } = loadStatusUI("components/BookingCard.tsx", os);
    for (const status of known) {
      const local = mapApiStatusToLocal(status);
      const result = module.bookingStatusConfig(local);
      const cancelled = ["cancelled", "rejected"].includes(local);
      assert.equal(result.label, local === "unknown" ? "Unknown" : cancelled ? "Cancelled" : "Available");
      assert.equal(result.color, local === "unknown" ? "#B6BDC6" : cancelled ? "#FF101B" : "#27C63F");
    }
    for (const value of [...invalid, "attendance_reversed"]) {
      const result = module.bookingStatusConfig(value);
      assert.equal(result.label, "Unknown"); assert.equal(result.color, "#B6BDC6");
      assert.equal(result.bg, "rgba(255,255,255,0.12)");
    }
  });

  test(`${os}: details actions fail closed for all unsupported and terminal states, including direct callback invocation`, () => {
    for (const status of [...known.map(mapApiStatusToLocal), ...invalid, "attendance_reversed"]) {
      const { module } = loadStatusUI("components/BookingDetailsView.tsx", os);
      let calls = 0;
      const tree = module.default({ booking: fixture(status), onClose() {}, onCancel: () => calls++ });
      const button = nodes(tree, node => node.type === "TouchableOpacity" && nodes(node, child => child.type === "Text").some(child => ["Cancel Booking", "Booking Cancelled", "Cancellation Closed"].includes(child.children[0])))[0];
      const allowed = status === "pending" || status === "confirmed";
      assert.equal(button.props.disabled, !allowed);
      button.props.onPress();
      assert.equal(calls, allowed ? 1 : 0);
      const label = nodes(button, node => node.type === "Text")[0].children[0];
      assert.equal(label, ["cancelled", "rejected"].includes(status as string) ? "Booking Cancelled" : allowed ? "Cancel Booking" : "Cancellation Closed");
    }
  });

  test(`${os}: allowed statuses still honor cutoff, missing occurrence and historical source guards`, () => {
    for (const status of ["pending", "confirmed"]) for (const overrides of [
      { sourceUnavailable: true }, { occurrenceDate: "2026-10-20", date: "2026-10-20" },
      { occurrenceDate: "2026-10-21", date: "2026-10-21", scheduleStartTime: "15:30" },
      { scheduleStartTime: null }, { occurrenceDate: undefined, date: "" },
    ]) {
      const { module } = loadStatusUI("components/BookingDetailsView.tsx", os);
      let calls = 0;
      const tree = module.default({ booking: { ...fixture(status), ...overrides }, onClose() {}, onCancel: () => calls++ });
      const button = nodes(tree, node => node.type === "TouchableOpacity" && nodes(node, child => child.type === "Text").some(child => ["Cancel Booking", "Booking Cancelled", "Cancellation Closed"].includes(child.children[0])))[0];
      assert.equal(button.props.disabled, true); button.props.onPress(); assert.equal(calls, 0);
    }
  });

  test(`${os}: route confirmation reaches the unchanged cancellation API only for recognized active own bookings`, async () => {
    for (const status of [...known.map(mapApiStatusToLocal), ...invalid, "attendance_reversed"]) {
      const view = loadStatusUI("app/booking/[id].tsx", os, fixture(status));
      const tree = view.module.default();
      nodes(tree, node => node.type === "BookingDetailsView")[0].props.onCancel();
      const allowed = status === "pending" || status === "confirmed";
      assert.equal(view.alerts.length, allowed ? 1 : 0);
      if (allowed) await view.alerts[0].actions[1].onPress();
      assert.deepEqual(view.requests, allowed ? ["own-booking"] : []);
    }
    const other = loadStatusUI("app/booking/[id].tsx", os, { ...fixture("confirmed"), id: "another-booking" });
    assert.equal(nodes(other.module.default(), node => node.type === "BookingDetailsView").length, 0);
  });

  test(`${os}: neutral booking status never fabricates a payment state or changes rail colors`, () => {
    const { module } = loadStatusUI("components/BookingCard.tsx", os);
    for (const [paymentStatus, label, color] of [["paid", "Paid", "#269134"], ["pending_payment", "Pending Payment", "#E2AA00"], ["failed", "Payment Failed", "#FF101B"], ["refunded", "Refunded", "#00B6D7"], ["not_required", "Paid", "#269134"]]) {
      const tree = module.default({ item: { ...fixture("unknown"), paymentStatus } });
      assert.ok(nodes(tree, node => node.type === "Text").some(node => node.children[0] === "Unknown"));
      assert.ok(nodes(tree, node => node.type === "Text").some(node => node.children[0] === label));
      assert.equal(tree.props.style[2].backgroundColor, color);
    }
  });
}

test("the existing list overlay also uses the strict status allowlist in its actual eligibility expression", () => {
  const source = readFileSync("artifacts/central/app/(tabs)/bookings.tsx", "utf8");
  const expression = source.match(/const canCancel = ([\s\S]*?);/)![1];
  for (const bookingStatus of [...known.map(mapApiStatusToLocal), ...invalid]) {
    const actual = runInNewContext(expression, { isBallet: false, isPast: false, isCancelled: false, b: fixture(bookingStatus), isSelfCancellableBookingStatus, isBookingSelfCancellableClientSide: (value: any) => isBookingSelfCancellableClientSide(value, new Date("2026-10-21T12:00:00Z")) });
    assert.equal(actual, bookingStatus === "pending" || bookingStatus === "confirmed");
  }
});
