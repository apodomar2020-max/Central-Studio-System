import http from "k6/http";
import { Trend } from "k6/metrics";
import { group } from "k6";
import { authHeaders, checkJsonGet, loginStudent, publicHeaders, randomSleep, url } from "./helpers.js";

const loginDuration = new Trend("student_login_duration");
const authReadDuration = new Trend("student_authenticated_read_duration");

export const options = {
  stages: [
    { duration: "2m", target: 50 },
    { duration: "5m", target: 50 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.02"],
    student_login_duration: ["p(95)<1500"],
    student_authenticated_read_duration: ["p(95)<1000"],
  },
};

const authenticatedReads = [
  "/api/my/bookings",
  "/api/my/packages",
  "/api/my/credits",
  "/api/my/attendance",
  "/api/notifications/my",
];

const publicReads = [
  "/api/classes",
  "/api/schedules",
  "/api/price-packages",
];

export default function () {
  let token = "";

  group("student login", () => {
    const started = Date.now();
    token = loginStudent();
    loginDuration.add(Date.now() - started);
  });

  if (!token) return;

  group("student authenticated reads", () => {
    for (const endpoint of authenticatedReads) {
      const res = http.get(url(endpoint), {
        headers: authHeaders(token),
        tags: { name: `GET ${endpoint}` },
      });
      authReadDuration.add(res.timings.duration);
      checkJsonGet(res, endpoint);
      randomSleep(0.2, 0.8);
    }
  });

  group("student public app data", () => {
    for (const endpoint of publicReads) {
      const res = http.get(url(endpoint), {
        headers: publicHeaders(),
        tags: { name: `GET ${endpoint}` },
      });
      checkJsonGet(res, endpoint);
      randomSleep(0.2, 0.8);
    }
  });

  if (__ENV.ENABLE_BOOKING_CREATE === "true") {
    throw new Error(
      "Booking creation is intentionally disabled in this suite. Add a separate staging-only script after confirming resettable schedules/classes.",
    );
  }

  randomSleep(1, 3);
}
