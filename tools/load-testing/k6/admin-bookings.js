import http from "k6/http";
import { check, group } from "k6";
import { adminHeaders, checkJsonGet, loginAdmin, randomSleep, safeJson, url } from "./helpers.js";

export const options = {
  stages: [
    { duration: "1m", target: 20 },
    { duration: "3m", target: 20 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<1500"],
  },
};

const pages = [
  "/api/bookings?page=1&pageSize=50",
  "/api/bookings?page=2&pageSize=50",
  "/api/bookings?page=1&pageSize=100",
  "/api/bookings?page=1&pageSize=50&search=test",
  "/api/bookings?page=1&pageSize=50&bookingStatus=pending",
];

function checkBookingsPayload(res) {
  check(res, {
    "bookings payload has pagination fields": (r) => {
      const body = safeJson(r, {});
      return Array.isArray(body.bookings)
        && typeof body.total === "number"
        && typeof body.page === "number"
        && typeof body.pageSize === "number"
        && typeof body.totalPages === "number";
    },
  });
}

export default function () {
  let token = "";

  group("admin login", () => {
    token = loginAdmin();
  });

  if (!token) return;

  group("admin bookings pagination", () => {
    for (const endpoint of pages) {
      const res = http.get(url(endpoint), {
        headers: adminHeaders(token),
        tags: { name: `GET ${endpoint.split("?")[0]}` },
      });
      checkJsonGet(res, endpoint);
      checkBookingsPayload(res);
      randomSleep(0.3, 1);
    }
  });

  randomSleep(1, 2);
}
