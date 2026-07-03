# Central Studio k6 Load Testing

This folder contains safe k6 scenarios for measuring Central Studio capacity on staging. The scripts cover public browsing, authenticated student reads, admin Bookings pagination, QR check-in eligibility, and a small smoke test.

## Safety Rules

Never run these tests against production.

Use a staging backend URL, a staging database, and test accounts only. Do not use real user accounts, real production data, or real QR tokens. QR check-in testing must use a staging booking that can be safely reset between runs. Booking creation tests must use test schedules/classes only. Credit and package tests must use disposable test packages only. Do not run destructive tests without resetting staging data first.

The included scripts are read-only by default. `qr-checkin.js` refuses to run unless `ENABLE_QR_TEST=true`, and it will not perform the QR check-in mutation unless `PERFORM_CHECKIN=true` is also set.

## Install k6

macOS:

```sh
brew install k6
```

Other platforms:

```sh
# See https://grafana.com/docs/k6/latest/set-up/install-k6/
k6 version
```

If k6 is not installed locally, install it before running the scripts. The app does not need to be typechecked for these files because they do not import project code.

## Prepare Staging Data

1. Confirm `BASE_URL` points to a staging API, not production.
2. Confirm staging uses a staging database seeded with safe test data.
3. Create a verified staging student account for `student-flow.js`.
4. Give the student disposable test packages, bookings, credit history, and attendance history if those reads should return non-empty results.
5. Create a staging admin account with the minimum permissions needed to view bookings and run QR checks.
6. For QR testing, prepare a resettable staging booking owned by the student behind `QR_TOKEN`.
7. Reset staging bookings, attendance rows, and credit/package state before any mutation run.

Only put real staging secrets in your shell or secret manager. Do not commit credentials. The files under `fixtures/` are examples only.

## Environment Variables

`BASE_URL`: Staging API base URL, for example `https://staging-api.example.com`.

`API_KEY`: Optional shared staging API key. Most `/api` routes are protected by the Central Studio shared API key; `/api/healthz` is public. Set this when staging requires `X-Api-Key`.

`STUDENT_EMAIL`: Verified staging student email for authenticated student reads.

`STUDENT_PASSWORD`: Password for the staging student account.

`ADMIN_EMAIL`: Staging admin username. The current admin login endpoint expects a `username`; use the staging admin username value here.

`ADMIN_PASSWORD`: Password for the staging admin account.

`QR_TOKEN`: Staging-only QR token for the QR scenario.

`TEST_SCHEDULE_ID`: Reserved for staging booking-create experiments. The included suite does not create bookings by default.

`TEST_CLASS_ID`: Reserved for staging booking-create experiments. The included suite does not create bookings by default.

`TEST_PACKAGE_ORDER_ID`: Disposable staging package order ID for package-credit QR check-in mutation, only when explicitly enabled.

`TEST_BOOKING_ID`: Staging booking ID used by `qr-checkin.js` only when `PERFORM_CHECKIN=true`.

`ENABLE_QR_TEST`: Must be `true` before `qr-checkin.js` will run.

`PERFORM_CHECKIN`: Must be `true` before `qr-checkin.js` sends `POST /api/check-in/qr`.

## Scripts

`k6/smoke.js`: Checks that staging is reachable with `GET /api/healthz`, falling back to `GET /api/classes` if health is unavailable. Default load is 1 VU for 30 seconds; set `VUS=5` for a slightly higher smoke.

`k6/public-browsing.js`: Anonymous GET-only browsing across classes, schedules, instructors, price packages, and hero items. Ramps to 50 VUs, holds for 5 minutes, then ramps down.

`k6/student-flow.js`: Logs in as a verified staging student, then reads bookings, packages, credits, attendance, notifications, and basic public app data. It does not create bookings.

`k6/admin-bookings.js`: Logs in as a staging admin and fetches Bookings page variants for pagination, page size, search, and pending status. It checks that responses include `bookings`, `total`, `page`, `pageSize`, and `totalPages`.

`k6/qr-checkin.js`: Sensitive QR scenario. By default it performs only a read-only admin bookings search as a QR eligibility probe. It requires `ENABLE_QR_TEST=true`, and mutation requires both `PERFORM_CHECKIN=true` and `TEST_BOOKING_ID`.

## Safe Commands

Smoke:

```sh
BASE_URL=https://staging-api.example.com k6 run tools/load-testing/k6/smoke.js
```

Public browsing:

```sh
BASE_URL=https://staging-api.example.com \
API_KEY=staging-shared-key \
k6 run tools/load-testing/k6/public-browsing.js
```

Student flow:

```sh
BASE_URL=https://staging-api.example.com \
API_KEY=staging-shared-key \
STUDENT_EMAIL=test@example.com \
STUDENT_PASSWORD=password \
k6 run tools/load-testing/k6/student-flow.js
```

Admin Bookings pagination:

```sh
BASE_URL=https://staging-api.example.com \
API_KEY=staging-shared-key \
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD=password \
k6 run tools/load-testing/k6/admin-bookings.js
```

QR read-only eligibility probe:

```sh
BASE_URL=https://staging-api.example.com \
API_KEY=staging-shared-key \
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD=password \
QR_TOKEN=test-token \
ENABLE_QR_TEST=true \
k6 run tools/load-testing/k6/qr-checkin.js
```

QR mutation, staging only after reset:

```sh
BASE_URL=https://staging-api.example.com \
API_KEY=staging-shared-key \
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD=password \
QR_TOKEN=test-token \
TEST_BOOKING_ID=1 \
ENABLE_QR_TEST=true \
PERFORM_CHECKIN=true \
k6 run tools/load-testing/k6/qr-checkin.js
```

## Thresholds

Smoke requires error rate below 1% and p95 latency below 800ms.

Public browsing requires error rate below 2% and p95 latency below 1000ms.

Student flow requires login p95 below 1500ms, authenticated read p95 below 1000ms, and total error rate below 2%.

Admin Bookings requires p95 below 1500ms and error rate below 2%.

QR requires read p95 below 1000ms, mutation p95 below 1200ms when enabled, and error rate below 2%.

In k6, p95 means 95% of requests completed faster than the threshold. `http_req_failed` includes non-2xx/3xx responses unless checks and request handling classify them differently.

## Reading Results

Start with `http_req_failed`, `http_req_duration`, and the custom trends:

```text
student_login_duration
student_authenticated_read_duration
qr_scan_read_duration
qr_checkin_mutation_duration
```

A failed threshold means the run did not meet the target capacity or reliability budget. Review endpoint-specific tags in the k6 output to identify the slowest or most error-prone route. Save exported summaries under `tools/load-testing/results/` only if they contain no secrets or personal data.

## What Not To Do

Do not point `BASE_URL` at production.

Do not use production API keys, admin users, students, QR tokens, bookings, packages, or schedules.

Do not run `PERFORM_CHECKIN=true` without first resetting staging data and confirming the booking is disposable.

Do not add booking creation or destructive cleanup to these scripts unless it is gated, documented, and tied to resettable staging fixtures.

Do not commit filled credential fixtures. Keep only `.example.json` files in git.

## Suggested First Sequence

1. Run `smoke.js` with only `BASE_URL`.
2. Run `public-browsing.js` with `BASE_URL` and `API_KEY` if staging requires it.
3. Run `student-flow.js` with one verified staging student.
4. Run `admin-bookings.js` with a read-only staging admin.
5. Run `qr-checkin.js` as read-only with `ENABLE_QR_TEST=true`.
6. Run QR mutation only in a short, supervised staging session after data reset.
