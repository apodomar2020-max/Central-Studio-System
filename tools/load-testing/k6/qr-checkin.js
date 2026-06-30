import http from "k6/http";
import { Trend } from "k6/metrics";
import { check, group } from "k6";
import { adminHeaders, checkJsonGet, loginAdmin, randomSleep, safeJson, url } from "./helpers.js";

const qrReadDuration = new Trend("qr_scan_read_duration");
const checkInMutationDuration = new Trend("qr_checkin_mutation_duration");

export const options = {
  stages: [
    { duration: "30s", target: 5 },
    { duration: "2m", target: 5 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.02"],
    qr_scan_read_duration: ["p(95)<1000"],
    qr_checkin_mutation_duration: ["p(95)<1200"],
  },
};

export function setup() {
  if (__ENV.ENABLE_QR_TEST !== "true") {
    throw new Error("QR test is disabled by default. Set ENABLE_QR_TEST=true only for staging resettable QR data.");
  }
  if (!__ENV.QR_TOKEN) {
    throw new Error("QR_TOKEN is required and must point to staging-only test data.");
  }
}

export default function () {
  let token = "";

  group("admin login", () => {
    token = loginAdmin();
  });

  if (!token) return;

  group("qr read-only eligibility probe", () => {
    const search = encodeURIComponent(__ENV.QR_SEARCH || "test");
    const res = http.get(url(`/api/bookings?page=1&pageSize=50&search=${search}`), {
      headers: adminHeaders(token),
      tags: { name: "GET /api/bookings qr eligibility probe" },
    });

    qrReadDuration.add(res.timings.duration);
    checkJsonGet(res, "qr eligibility bookings search");
    check(res, {
      "qr eligibility payload includes bookings": (r) => Array.isArray(safeJson(r, {})?.bookings),
    });
  });

  if (__ENV.PERFORM_CHECKIN !== "true") {
    randomSleep(1, 2);
    return;
  }

  group("qr check-in mutation - staging only", () => {
    const bookingId = Number(__ENV.TEST_BOOKING_ID || 0);
    if (!bookingId) {
      throw new Error("TEST_BOOKING_ID is required when PERFORM_CHECKIN=true.");
    }

    const body = {
      qrToken: __ENV.QR_TOKEN,
      bookingId,
      paymentMode: __ENV.QR_PAYMENT_MODE || "pay_at_studio",
      checkedInBy: __ENV.CHECKED_IN_BY || "k6-staging-load-test",
    };

    if (body.paymentMode === "package_credit") {
      const packageOrderId = Number(__ENV.TEST_PACKAGE_ORDER_ID || 0);
      if (!packageOrderId) {
        throw new Error("TEST_PACKAGE_ORDER_ID is required for package_credit QR check-in.");
      }
      body.packageOrderId = packageOrderId;
    }

    const res = http.post(url("/api/check-in/qr"), JSON.stringify(body), {
      headers: adminHeaders(token, { "Content-Type": "application/json" }),
      tags: { name: "POST /api/check-in/qr" },
    });

    checkInMutationDuration.add(res.timings.duration);
    check(res, {
      "qr check-in mutation accepted": (r) => r.status === 201,
      "qr check-in response is json": (r) => safeJson(r) !== null,
    });
  });

  randomSleep(1, 2);
}
