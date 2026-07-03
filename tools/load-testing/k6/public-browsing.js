import http from "k6/http";
import { group } from "k6";
import { checkJsonGet, publicHeaders, randomSleep, url } from "./helpers.js";

export const options = {
  stages: [
    { duration: "2m", target: 50 },
    { duration: "5m", target: 50 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<1000"],
  },
};

const endpoints = [
  "/api/classes",
  "/api/schedules",
  "/api/instructors",
  "/api/price-packages",
  "/api/hero-items",
];

export default function () {
  group("anonymous public browsing", () => {
    for (const endpoint of endpoints) {
      const res = http.get(url(endpoint), {
        headers: publicHeaders(),
        tags: { name: `GET ${endpoint}` },
      });
      checkJsonGet(res, endpoint);
      randomSleep(0.2, 0.8);
    }
  });

  randomSleep(1, 3);
}
