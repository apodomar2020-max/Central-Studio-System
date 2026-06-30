import http from "k6/http";
import { check, sleep } from "k6";

export const BASE_URL = (__ENV.BASE_URL || "https://staging-api.example.com").replace(/\/$/, "");
export const API_KEY = __ENV.API_KEY || "";

export function publicHeaders(extra = {}) {
  const headers = {
    Accept: "application/json",
    ...extra,
  };
  if (API_KEY) headers["X-Api-Key"] = API_KEY;
  return headers;
}

export function authHeaders(token, extra = {}) {
  return {
    ...publicHeaders(extra),
    Authorization: `Bearer ${token}`,
  };
}

export function adminHeaders(token, extra = {}) {
  return {
    ...publicHeaders(extra),
    "X-Admin-Token": token,
  };
}

export function safeJson(res, fallback = null) {
  try {
    return res.json();
  } catch (_error) {
    return fallback;
  }
}

export function randomSleep(minSeconds = 0.5, maxSeconds = 2) {
  sleep(Math.random() * (maxSeconds - minSeconds) + minSeconds);
}

export function url(path) {
  return `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function loginStudent() {
  const email = __ENV.STUDENT_EMAIL;
  const password = __ENV.STUDENT_PASSWORD;

  if (!email || !password) {
    throw new Error("STUDENT_EMAIL and STUDENT_PASSWORD are required for student-flow.js");
  }

  const res = http.post(
    url("/api/auth/login"),
    JSON.stringify({ email, password }),
    { headers: publicHeaders({ "Content-Type": "application/json" }), tags: { name: "student_login" } },
  );

  check(res, {
    "student login succeeded": (r) => r.status === 200 && Boolean(safeJson(r, {})?.accessToken),
    "student account is verified": (r) => safeJson(r, {})?.requiresOtp !== true,
  });

  return safeJson(res, {})?.accessToken || "";
}

export function loginAdmin() {
  const username = __ENV.ADMIN_EMAIL;
  const password = __ENV.ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required for admin tests");
  }

  const res = http.post(
    url("/api/admin/auth/login"),
    JSON.stringify({ username, password }),
    { headers: publicHeaders({ "Content-Type": "application/json" }), tags: { name: "admin_login" } },
  );

  check(res, {
    "admin login succeeded": (r) => r.status === 200 && Boolean(safeJson(r, {})?.token),
  });

  return safeJson(res, {})?.token || "";
}

export function checkJsonGet(res, label, status = 200) {
  return check(res, {
    [`${label} returned ${status}`]: (r) => r.status === status,
    [`${label} returned json`]: (r) => safeJson(r) !== null,
  });
}
