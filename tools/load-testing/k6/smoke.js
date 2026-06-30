import http from "k6/http";
import { check, group } from "k6";
import { checkJsonGet, publicHeaders, randomSleep, url } from "./helpers.js";

export const options = {
  vus: Number(__ENV.VUS || 1),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};

export default function () {
  group("staging api reachability", () => {
    const health = http.get(url("/api/healthz"), {
      headers: publicHeaders(),
      tags: { name: "GET /api/healthz" },
    });

    const healthOk = check(health, {
      "health endpoint reachable": (r) => r.status === 200,
    });

    if (healthOk) {
      checkJsonGet(health, "health");
    } else {
      const classes = http.get(url("/api/classes"), {
        headers: publicHeaders(),
        tags: { name: "GET /api/classes fallback" },
      });
      checkJsonGet(classes, "classes fallback");
    }
  });

  randomSleep(0.5, 1.5);
}
