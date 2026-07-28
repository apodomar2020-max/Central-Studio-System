import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_ROUTES_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /disposable|test|local/i);
  assert.doesNotMatch(databaseUrl, /railway|rlwy\.net/i);
}

assertDisposableUrl(DATABASE_URL);
process.env.DATABASE_URL = DATABASE_URL;
process.env.API_SECRET_KEY = "phase-b-http-test-key";
process.env.STUDENT_JWT_SECRET = "phase-b-student-secret";
process.env.ADMIN_JWT_SECRET = "phase-b-admin-secret";
delete process.env.REDIS_URL;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port = 0;
let signJwt: (payload: object, secret: string, options?: object) => string;
let superAdminId = 0;
let restrictedAdminId = 0;

const classIds: Record<string, number> = {};
const packageIds: Record<string, number> = {};
const scheduleIds: Record<string, number> = {};
const studentIds: Record<string, number> = {};
const danceTypeIds: number[] = [];

function cairoToday(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addYears(iso: string, delta: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${String(year + delta).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

function studentToken(key: string, options?: { expiresIn?: string }): string {
  return signJwt({
    sub: studentIds[key],
    email: `${key}@example.invalid`,
    type: "student",
    emailVerified: true,
  }, "phase-b-student-secret", { expiresIn: options?.expiresIn ?? "1h" });
}

function tokenForMissingAccount(): string {
  return signJwt({
    sub: 2_000_000_000,
    email: "missing@example.invalid",
    type: "student",
    emailVerified: true,
  }, "phase-b-student-secret", { expiresIn: "1h" });
}

function adminToken(userId = superAdminId): string {
  return signJwt({
    sub: userId,
    username: `phase-b-admin-${userId}`,
    isSuperAdmin: userId === superAdminId,
    roleId: null,
  }, "phase-b-admin-secret", { expiresIn: "1h" });
}

function url(path: string): string {
  return `http://127.0.0.1:${port}/api${path}`;
}

async function request(
  path: string,
  options: RequestInit & { student?: string; adminId?: number; guest?: boolean } = {},
): Promise<Response> {
  const { student, adminId, guest = student == null && adminId == null, ...init } = options;
  return fetch(url(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(guest ? { "x-api-key": "phase-b-http-test-key" } : {}),
      ...(student ? { authorization: `Bearer ${studentToken(student)}` } : {}),
      ...(adminId != null
        ? { "x-api-key": "phase-b-http-test-key", "x-admin-token": adminToken(adminId) }
        : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function insertClass(
  key: string,
  range: { allow: boolean | null; min: number | null; max: number | null },
  options: { active?: boolean; danceTypeId?: number | null } = {},
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO classes
      (title, category, dance_type_id, level, age_group, allow_all_ages, min_age, max_age,
       duration_mins, capacity, is_active)
     VALUES ($1, 'Studio', $2, 'All Levels', 'legacy', $3, $4, $5, 60, 20, $6)
     RETURNING id`,
    [
      `Phase B ${key}`,
      options.danceTypeId === undefined ? danceTypeIds[0] : options.danceTypeId,
      range.allow,
      range.min,
      range.max,
      options.active ?? true,
    ],
  );
  classIds[key] = result.rows[0].id as number;
  return classIds[key];
}

async function insertPackage(
  key: string,
  range: { allow: boolean | null; min: number | null; max: number | null },
  options: { active?: boolean; legacyDanceTypes?: string[] } = {},
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO price_packages
      (name, type, price_egp, sessions, is_active, validity_months, allowed_dance_types,
       allow_all_ages, min_age, max_age)
     VALUES ($1, 'per_class', 1000, 8, $2, 6, $3::text[], $4, $5, $6)
     RETURNING id`,
    [
      `Phase B ${key}`,
      options.active ?? true,
      options.legacyDanceTypes ?? [],
      range.allow,
      range.min,
      range.max,
    ],
  );
  packageIds[key] = result.rows[0].id as number;
  return packageIds[key];
}

before(async () => {
  const express = (await import("express")).default;
  signJwt = (await import("jsonwebtoken")).default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const classesRouter = (await import("./classes")).default;
  const schedulesRouter = (await import("./schedules")).default;
  const packagesRouter = (await import("./pricePackages")).default;
  const readinessRouter = (await import("./catalogueReadiness")).default;
  const db = await import("@workspace/db");
  pool = db.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", classesRouter);
  app.use("/api", schedulesRouter);
  app.use("/api", packagesRouter);
  app.use("/api", readinessRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const superUser = await pool.query(
    `INSERT INTO system_users
      (username, email, password_hash, full_name, is_super_admin, is_active)
     VALUES ($1, $2, 'x', 'Phase B Super', true, true) RETURNING id`,
    [`phase-b-super-${run}`, `phase-b-super-${run}@example.invalid`],
  );
  superAdminId = superUser.rows[0].id as number;
  const restrictedUser = await pool.query(
    `INSERT INTO system_users
      (username, email, password_hash, full_name, is_super_admin, is_active)
     VALUES ($1, $2, 'x', 'Phase B Restricted', false, true) RETURNING id`,
    [`phase-b-restricted-${run}`, `phase-b-restricted-${run}@example.invalid`],
  );
  restrictedAdminId = restrictedUser.rows[0].id as number;

  for (const [name, slug] of [["Ballet", `phase-b-ballet-${run}`], ["Hip Hop", `phase-b-hiphop-${run}`]]) {
    const result = await pool.query(
      `INSERT INTO dance_types (name, slug, is_active, sort_order)
       VALUES ($1, $2, true, 0) RETURNING id`,
      [name, slug],
    );
    danceTypeIds.push(result.rows[0].id as number);
  }

  await insertClass("inactive", { allow: true, min: null, max: null }, { active: false });
  await insertClass("all", { allow: true, min: null, max: null });
  await insertClass("kids", { allow: false, min: 5, max: 12 });
  await insertClass("teens", { allow: false, min: 13, max: 17 });
  await insertClass("adults", { allow: false, min: 18, max: null });
  await insertClass("custom", { allow: false, min: 10, max: 15 });
  await insertClass("legacy", { allow: null, min: null, max: null });
  await insertClass("missing-dance", { allow: true, min: null, max: null }, { danceTypeId: null });

  await insertPackage("inactive", { allow: true, min: null, max: null }, { active: false });
  await insertPackage("all", { allow: true, min: null, max: null });
  await insertPackage("kids", { allow: false, min: 5, max: 12 });
  await insertPackage("teens", { allow: false, min: 13, max: 17 });
  await insertPackage("adults", { allow: false, min: 18, max: null });
  await insertPackage("custom", { allow: false, min: 10, max: 15 });
  await insertPackage("legacy", { allow: null, min: null, max: null });
  await insertPackage("legacy-dance", { allow: true, min: null, max: null }, { legacyDanceTypes: ["Legacy Style"] });
  await pool.query(
    `INSERT INTO price_package_dance_types (package_id, dance_type_id)
     VALUES ($1, $2), ($3, $2), ($3, $4)`,
    [packageIds.kids, danceTypeIds[0], packageIds.teens, danceTypeIds[1]],
  );

  const today = cairoToday();
  const nextWeek = addDays(today, 7);
  const schedules = [
    ["recurring-kids", classIds.kids, "weekly", "active", dayOfWeek(today), null, true],
    ["birthday-teens", classIds.teens, "one_time", "active", dayOfWeek(nextWeek), nextWeek, false],
    ["all", classIds.all, "one_time", "active", dayOfWeek(nextWeek), nextWeek, false],
    ["cancelled", classIds.all, "weekly", "cancelled", dayOfWeek(today), null, true],
  ] as const;
  for (const [key, classId, type, status, dow, date, recurring] of schedules) {
    const result = await pool.query(
      `INSERT INTO schedules
        (class_id, type, status, day_of_week, date, start_time, end_time, package_eligible, is_recurring)
       VALUES ($1, $2, $3, $4, $5, '10:00', '11:00', true, $6) RETURNING id`,
      [classId, type, status, dow, date, recurring],
    );
    scheduleIds[key] = result.rows[0].id as number;
  }

  const ages = [4, 5, 12, 13, 17, 18];
  for (const age of ages) {
    const key = `age${age}`;
    const result = await pool.query(
      `INSERT INTO students
        (name, email, account_type, date_of_birth, email_verified, profile_completed)
       VALUES ($1, $2, 'student', $3, true, true) RETURNING id`,
      [`Phase B ${key}`, `${key}@example.invalid`, addYears(today, -age)],
    );
    studentIds[key] = result.rows[0].id as number;
  }
  const missing = await pool.query(
    `INSERT INTO students
      (name, email, account_type, date_of_birth, email_verified, profile_completed)
     VALUES ('Missing DOB', 'missingDob@example.invalid', 'student', NULL, true, false)
     RETURNING id`,
  );
  studentIds.missingDob = missing.rows[0].id as number;
  const parent = await pool.query(
    `INSERT INTO students
      (name, email, account_type, date_of_birth, email_verified, profile_completed)
     VALUES ('Parent', 'parent@example.invalid', 'parent', $1, true, true)
     RETURNING id`,
    [addYears(today, -35)],
  );
  studentIds.parent = parent.rows[0].id as number;
  await pool.query(
    `INSERT INTO children (parent_id, full_name, date_of_birth, gender)
     VALUES ($1, 'Child One', $2, 'female'), ($1, 'Child Two', $3, 'male')`,
    [studentIds.parent, addYears(today, -6), addYears(today, -16)],
  );

  // The one-time Teens occurrence is exactly this student's 13th birthday.
  const birthdayStudent = await pool.query(
    `INSERT INTO students
      (name, email, account_type, date_of_birth, email_verified, profile_completed)
     VALUES ('Birthday Student', 'birthday@example.invalid', 'student', $1, true, true)
     RETURNING id`,
    [addYears(nextWeek, -13)],
  );
  studentIds.birthday = birthdayStudent.rows[0].id as number;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await pool.end();
});

test("Guest catalogue remains complete, public-cached, and non-personalized", async () => {
  for (const path of ["/classes", "/schedules", "/price-packages"]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
    assert.match(response.headers.get("vary") ?? "", /Authorization/i);
    const rows = await body<Array<Record<string, unknown>>>(response);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) =>
      (row.catalogueEligibility as Record<string, unknown>).evaluated === false
    ));
    assert.ok(rows.every((row) =>
      (row.catalogueEligibility as Record<string, unknown>).participantAge === undefined
    ));
  }

  const classes = await body<Array<Record<string, unknown>>>(await request("/classes"));
  assert.ok(classes.some((row) => row.id === classIds.legacy && row.configurationState === "legacy_unconfigured"));
  assert.ok(!classes.some((row) => row.id === classIds.inactive));

  const packages = await body<Array<Record<string, unknown>>>(await request("/price-packages"));
  assert.ok(packages.some((row) => row.id === packageIds.legacy && row.configurationState === "legacy_unconfigured"));
  assert.ok(!packages.some((row) => row.id === packageIds.inactive));

  for (const path of [
    `/classes/${classIds.kids}`,
    `/schedules/${scheduleIds["recurring-kids"]}`,
    `/price-packages/${packageIds.kids}`,
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal((await body<Record<string, any>>(response)).catalogueEligibility.evaluated, false);
  }
});

test("Student class and package lists enforce inclusive boundaries over the full result set", async () => {
  const expected: Record<string, { classes: string[]; packages: string[] }> = {
    age4: { classes: ["all", "legacy", "missing-dance"], packages: ["all", "legacy", "legacy-dance"] },
    age5: { classes: ["all", "kids", "legacy", "missing-dance"], packages: ["all", "kids", "legacy", "legacy-dance"] },
    age12: { classes: ["all", "kids", "custom", "legacy", "missing-dance"], packages: ["all", "kids", "custom", "legacy", "legacy-dance"] },
    age13: { classes: ["all", "teens", "custom", "legacy", "missing-dance"], packages: ["all", "teens", "custom", "legacy", "legacy-dance"] },
    age17: { classes: ["all", "teens", "legacy", "missing-dance"], packages: ["all", "teens", "legacy", "legacy-dance"] },
    age18: { classes: ["all", "adults", "legacy", "missing-dance"], packages: ["all", "adults", "legacy", "legacy-dance"] },
  };
  for (const [student, visible] of Object.entries(expected)) {
    const classRows = await body<Array<Record<string, unknown>>>(
      await request("/classes", { student, guest: false }),
    );
    const packageRows = await body<Array<Record<string, unknown>>>(
      await request("/price-packages", { student, guest: false }),
    );
    assert.deepEqual(
      Object.entries(classIds).filter(([, id]) => classRows.some((row) => row.id === id)).map(([key]) => key).sort(),
      visible.classes.sort(),
    );
    assert.deepEqual(
      Object.entries(packageIds).filter(([, id]) => packageRows.some((row) => row.id === id)).map(([key]) => key).sort(),
      visible.packages.sort(),
    );
    assert.equal(classRows.some((row) => row.id === classIds.inactive), false);
    assert.equal(packageRows.some((row) => row.id === packageIds.inactive), false);
  }
});

test("Student details stay accessible with authoritative eligibility annotations", async () => {
  const ineligible = await request(`/classes/${classIds.kids}`, { student: "age18", guest: false });
  assert.equal(ineligible.status, 200);
  assert.equal(ineligible.headers.get("cache-control"), "private, no-store");
  const ineligibleBody = await body<Record<string, any>>(ineligible);
  assert.equal(ineligibleBody.catalogueEligibility.evaluated, true);
  assert.equal(ineligibleBody.catalogueEligibility.eligible, false);
  assert.equal(ineligibleBody.catalogueEligibility.participantAge, 18);
  assert.equal(ineligibleBody.catalogueEligibility.reasons[0].code, "AGE_ABOVE_MAXIMUM");
  assert.match(ineligibleBody.catalogueEligibility.evaluatedOn, /^\d{4}-\d{2}-\d{2}$/);

  const eligible = await body<Record<string, any>>(
    await request(`/price-packages/${packageIds.kids}`, { student: "age5", guest: false }),
  );
  assert.equal(eligible.catalogueEligibility.eligible, true);
  assert.deepEqual(eligible.allowedDanceTypeIds, [danceTypeIds[0]]);
});

test("Missing DOB is explicit and never silently treated as eligible", async () => {
  const response = await request("/classes", { student: "missingDob", guest: false });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const rows = await body<Array<Record<string, any>>>(response);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.catalogueEligibility.eligible === false));
  assert.ok(rows.every((row) => row.catalogueEligibility.reasons[0]?.code === "DOB_REQUIRED"));
});

test("Schedule filtering uses represented occurrence dates, including the birthday boundary", async () => {
  const birthdayRows = await body<Array<Record<string, any>>>(
    await request("/schedules", { student: "birthday", guest: false }),
  );
  const birthdaySchedule = birthdayRows.find((row) => row.id === scheduleIds["birthday-teens"]);
  assert.ok(birthdaySchedule);
  assert.equal(birthdaySchedule.catalogueEligibility.eligible, true);
  assert.equal(birthdaySchedule.catalogueEligibility.participantAge, 13);
  assert.equal(birthdaySchedule.occurrenceDateUsedForEligibility, addDays(cairoToday(), 7));
  assert.ok(!birthdayRows.some((row) => row.id === scheduleIds.cancelled));

  const age5Rows = await body<Array<Record<string, any>>>(
    await request("/schedules", { student: "age5", guest: false }),
  );
  assert.ok(age5Rows.some((row) => row.id === scheduleIds["recurring-kids"]));
  assert.ok(!age5Rows.some((row) => row.id === scheduleIds["birthday-teens"]));
});

test("Parent sees the full catalogue and children do not trigger evaluation", async () => {
  for (const path of ["/classes", "/schedules", "/price-packages"]) {
    const response = await request(path, { student: "parent", guest: false });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const rows = await body<Array<Record<string, any>>>(response);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.catalogueEligibility.evaluated === false));
    assert.ok(rows.every((row) => row.catalogueEligibility.participantType === undefined));
  }
});

test("Authentication policy rejects malformed, expired, and orphan identities and ignores forged claims", async () => {
  assert.equal((await fetch(url("/classes"))).status, 401);
  assert.equal((await fetch(url("/classes"), {
    headers: { authorization: "Bearer malformed.jwt.token" },
  })).status, 401);
  const expired = signJwt({
    sub: studentIds.age5,
    email: "age5@example.invalid",
    type: "student",
  }, "phase-b-student-secret", { expiresIn: -1 });
  assert.equal((await fetch(url("/classes"), {
    headers: { authorization: `Bearer ${expired}` },
  })).status, 401);
  assert.equal((await fetch(url("/classes"), {
    headers: { authorization: `Bearer ${tokenForMissingAccount()}` },
  })).status, 401);

  const forged = await request("/classes?accountType=parent&dateOfBirth=1900-01-01", {
    student: "age5",
    guest: false,
    headers: { "x-account-type": "parent", "x-date-of-birth": "1900-01-01" },
  });
  const rows = await body<Array<Record<string, any>>>(forged);
  assert.ok(rows.some((row) => row.id === classIds.kids));
  assert.ok(!rows.some((row) => row.id === classIds.adults));
});

test("Class and package HTTP writes validate ranges and preserve omitted PATCH fields", async () => {
  const classCreate = await request("/classes", {
    adminId: superAdminId,
    guest: false,
    method: "POST",
    body: JSON.stringify({
      title: "HTTP Custom Class",
      category: "Studio",
      danceTypeId: danceTypeIds[0],
      level: "All Levels",
      ageGroup: "legacy",
      allowAllAges: false,
      minAge: 10,
      maxAge: 15,
      durationMins: 60,
      capacity: 20,
      isActive: true,
    }),
  });
  assert.equal(classCreate.status, 201);
  const createdClass = await body<Record<string, any>>(classCreate);
  assert.equal(createdClass.ageRangeLabel, "10–15");

  const invalidClass = await request("/classes", {
    adminId: superAdminId,
    guest: false,
    method: "POST",
    body: JSON.stringify({
      title: "Invalid Class",
      category: "Studio",
      level: "All Levels",
      allowAllAges: true,
      minAge: 5,
      maxAge: 12,
      durationMins: 60,
      capacity: 20,
    }),
  });
  assert.equal(invalidClass.status, 400);
  assert.equal((await body<Record<string, any>>(invalidClass)).code, "AGE_RANGE_INVALID");

  const preserved = await request(`/classes/${createdClass.id}`, {
    adminId: superAdminId,
    guest: false,
    method: "PATCH",
    body: JSON.stringify({ title: "HTTP Custom Class Updated" }),
  });
  assert.equal(preserved.status, 200);
  const preservedBody = await body<Record<string, any>>(preserved);
  assert.deepEqual(
    [preservedBody.allowAllAges, preservedBody.minAge, preservedBody.maxAge],
    [false, 10, 15],
  );

  for (const invalid of [
    { allowAllAges: false, minAge: null, maxAge: 12 },
    { allowAllAges: false, minAge: 13, maxAge: 12 },
    { allowAllAges: false, minAge: -1, maxAge: 12 },
    { allowAllAges: false, minAge: 18, maxAge: 151 },
    { allowAllAges: false, minAge: 10.5, maxAge: 15 },
  ]) {
    const response = await request(`/classes/${createdClass.id}`, {
      adminId: superAdminId,
      guest: false,
      method: "PATCH",
      body: JSON.stringify(invalid),
    });
    assert.equal(response.status, 400);
  }
});

test("Package canonical dance-type writes are transactional and authoritative", async () => {
  const createPayload = {
    name: `HTTP Restricted ${Date.now()}`,
    type: "per_class",
    priceEgp: 1200,
    sessions: 8,
    isActive: true,
    isFeatured: false,
    validityMonths: 6,
    allowedDanceTypeIds: [danceTypeIds[0], danceTypeIds[0], danceTypeIds[1]],
    allowAllAges: false,
    minAge: 13,
    maxAge: 17,
    features: [],
  };
  const createdResponse = await request("/price-packages", {
    adminId: superAdminId,
    guest: false,
    method: "POST",
    body: JSON.stringify(createPayload),
  });
  assert.equal(createdResponse.status, 201);
  const created = await body<Record<string, any>>(createdResponse);
  assert.deepEqual([...created.allowedDanceTypeIds].sort(), [...danceTypeIds].sort());
  assert.equal(created.allowedDanceTypeDetails.length, 2);
  assert.equal(created.danceTypeUnrestricted, false);
  assert.deepEqual([...created.allowedDanceTypes].sort(), ["Ballet", "Hip Hop"].sort());
  const relationCount = await pool.query(
    `SELECT count(*)::int AS n FROM price_package_dance_types WHERE package_id = $1`,
    [created.id],
  );
  assert.equal(relationCount.rows[0].n, 2);

  const omitted = await request(`/price-packages/${created.id}`, {
    adminId: superAdminId,
    guest: false,
    method: "PATCH",
    body: JSON.stringify({ name: "HTTP Restricted Renamed" }),
  });
  assert.equal(omitted.status, 200);
  assert.deepEqual(
    [...(await body<Record<string, any>>(omitted)).allowedDanceTypeIds].sort(),
    [...danceTypeIds].sort(),
  );

  const invalidId = 2_000_000_000;
  const before = await pool.query(
    `SELECT name, allowed_dance_types FROM price_packages WHERE id = $1`,
    [created.id],
  );
  const invalidUpdate = await request(`/price-packages/${created.id}`, {
    adminId: superAdminId,
    guest: false,
    method: "PATCH",
    body: JSON.stringify({ name: "Must Roll Back", allowedDanceTypeIds: [invalidId] }),
  });
  assert.equal(invalidUpdate.status, 400);
  const afterInvalid = await pool.query(
    `SELECT name, allowed_dance_types FROM price_packages WHERE id = $1`,
    [created.id],
  );
  assert.deepEqual(afterInvalid.rows[0], before.rows[0]);

  const cleared = await request(`/price-packages/${created.id}`, {
    adminId: superAdminId,
    guest: false,
    method: "PATCH",
    body: JSON.stringify({ allowedDanceTypeIds: [] }),
  });
  assert.equal(cleared.status, 200);
  const clearedBody = await body<Record<string, any>>(cleared);
  assert.deepEqual(clearedBody.allowedDanceTypeIds, []);
  assert.equal(clearedBody.danceTypeUnrestricted, true);
  assert.equal(clearedBody.danceTypeConfigurationState, "unrestricted");

  const invalidCreateName = `Invalid Package ${Date.now()}`;
  const invalidCreate = await request("/price-packages", {
    adminId: superAdminId,
    guest: false,
    method: "POST",
    body: JSON.stringify({ ...createPayload, name: invalidCreateName, allowedDanceTypeIds: [invalidId] }),
  });
  assert.equal(invalidCreate.status, 400);
  const orphan = await pool.query(`SELECT count(*)::int AS n FROM price_packages WHERE name = $1`, [invalidCreateName]);
  assert.equal(orphan.rows[0].n, 0);

  assert.equal((await request("/price-packages", {
    student: "age18",
    guest: false,
    method: "POST",
    body: JSON.stringify(createPayload),
  })).status, 403);
  assert.equal((await request("/price-packages", {
    adminId: restrictedAdminId,
    guest: false,
    method: "POST",
    body: JSON.stringify(createPayload),
  })).status, 403);
});

test("Catalogue readiness is permission-protected, PII-free, and read-only", async () => {
  assert.equal((await request("/admin/catalogue-readiness")).status, 401);
  assert.equal((await request("/admin/catalogue-readiness", {
    adminId: restrictedAdminId,
    guest: false,
  })).status, 403);

  const beforeCounts = await pool.query(
    `SELECT
       (SELECT count(*) FROM classes)::int AS classes,
       (SELECT count(*) FROM price_packages)::int AS packages,
       (SELECT count(*) FROM price_package_dance_types)::int AS relations`,
  );
  const response = await request("/admin/catalogue-readiness", {
    adminId: superAdminId,
    guest: false,
  });
  assert.equal(response.status, 200);
  const result = await body<Record<string, any>>(response);
  assert.ok(result.ids.activeClassesUnconfiguredAge.includes(classIds.legacy));
  assert.ok(result.ids.activePackagesUnconfiguredAge.includes(packageIds.legacy));
  assert.ok(result.ids.activeClassesMissingCanonicalDanceType.includes(classIds["missing-dance"]));
  assert.ok(result.ids.packagesWithLegacyRestrictionOnly.includes(packageIds["legacy-dance"]));
  assert.equal(result.counts.classesWithInvalidAgeRange, 0);
  assert.equal(result.counts.packagesWithInvalidAgeRange, 0);
  assert.doesNotMatch(JSON.stringify(result), /email|phone|dateOfBirth|studentName|child/i);

  const repeated = await request("/admin/catalogue-readiness", {
    adminId: superAdminId,
    guest: false,
  });
  assert.equal(repeated.status, 200);
  const afterCounts = await pool.query(
    `SELECT
       (SELECT count(*) FROM classes)::int AS classes,
       (SELECT count(*) FROM price_packages)::int AS packages,
       (SELECT count(*) FROM price_package_dance_types)::int AS relations`,
  );
  assert.deepEqual(afterCounts.rows[0], beforeCounts.rows[0]);
});

test("Migration 0088 constraints enforce canonical relation integrity", async () => {
  const names = await pool.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'price_package_dance_types'::regclass`,
  );
  const constraintNames = names.rows.map((row) => row.conname);
  assert.ok(constraintNames.includes("price_package_dance_types_package_id_dance_type_id_pk"));
  assert.ok(constraintNames.includes("price_package_dance_types_package_id_price_packages_id_fk"));
  assert.ok(constraintNames.includes("price_package_dance_types_dance_type_id_dance_types_id_fk"));
  const index = await pool.query(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'price_package_dance_types'
       AND indexname = 'price_package_dance_types_dance_type_id_idx'`,
  );
  assert.equal(index.rows.length, 1);

  await pool.query("BEGIN");
  try {
    const packageRow = await pool.query(
      `INSERT INTO price_packages (name, type, price_egp) VALUES ('Constraint Package', 'per_class', 1) RETURNING id`,
    );
    const packageId = packageRow.rows[0].id as number;
    await pool.query(
      `INSERT INTO price_package_dance_types (package_id, dance_type_id) VALUES ($1, $2)`,
      [packageId, danceTypeIds[0]],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO price_package_dance_types (package_id, dance_type_id) VALUES ($1, $2)`,
        [packageId, danceTypeIds[0]],
      ),
      /duplicate key/i,
    );
  } finally {
    await pool.query("ROLLBACK");
  }

  await assert.rejects(
    pool.query(
      `INSERT INTO price_package_dance_types (package_id, dance_type_id) VALUES ($1, $2)`,
      [2_000_000_000, danceTypeIds[0]],
    ),
    /foreign key/i,
  );

  const cascadePackage = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp) VALUES ('Cascade Package', 'per_class', 1) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO price_package_dance_types (package_id, dance_type_id) VALUES ($1, $2)`,
    [cascadePackage.rows[0].id, danceTypeIds[0]],
  );
  await assert.rejects(
    pool.query(`DELETE FROM dance_types WHERE id = $1`, [danceTypeIds[0]]),
    /foreign key/i,
  );
  await pool.query(`DELETE FROM price_packages WHERE id = $1`, [cascadePackage.rows[0].id]);
  const cascaded = await pool.query(
    `SELECT count(*)::int AS n FROM price_package_dance_types WHERE package_id = $1`,
    [cascadePackage.rows[0].id],
  );
  assert.equal(cascaded.rows[0].n, 0);
});
