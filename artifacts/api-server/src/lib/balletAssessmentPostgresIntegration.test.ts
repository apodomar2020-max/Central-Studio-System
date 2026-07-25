import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("../../../../lib/db/node_modules/pg");
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";
import http from "node:http";
import jwt from "jsonwebtoken";
import {
  balletLevelsTable,
  balletClassesTable,
  balletSchedulesTable,
  balletClassLevelsTable,
  balletApplicationsTable,
  childrenTable,
  studentsTable,
} from "@workspace/db";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_test";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: host ${url.hostname} is not localhost`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: db name ${url.pathname} does not look disposable/local/test`);
  }
}
assertDisposableUrl(DATABASE_URL);

process.env.DATABASE_URL = DATABASE_URL;
process.env.STUDENT_JWT_SECRET = "dev-student-secret-change-in-production";

let app: express.Express;
let server: http.Server;
let pool: any;
let port: number;
const STUDENT_SECRET = "dev-student-secret-change-in-production";

function apiUrl(p: string): string {
  return `http://127.0.0.1:${port}${p}`;
}

function studentToken(studentId: number, email: string): string {
  return jwt.sign({ sub: studentId, email, type: "student", emailVerified: true }, STUDENT_SECRET);
}

before(async () => {
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  const balletRouterModule = await import("../routes/ballet");
  const balletRouter = balletRouterModule.default;

  app = express();
  app.use(express.json());
  app.use("/api", balletRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      port = addr.port;
      resolve();
    });
  });
});

after(async () => {
  if (server) server.close();
  if (pool) await pool.end();
});

test("Real Postgres Integration: 6y9m child matches active canonical class and projects occurrence", async () => {
  const dbClient = drizzle(pool);

  await pool.query("TRUNCATE ballet_applications, ballet_schedules, ballet_class_levels, ballet_classes, ballet_levels, children, students CASCADE");

  const [student] = await dbClient.insert(studentsTable).values({
    name: "Parent Test",
    email: "parent@test.com",
    passwordHash: "hash",
  }).returning();

  const [child] = await dbClient.insert(childrenTable).values({
    parentId: student.id,
    fullName: "Lily Test",
    birthday: "2019-10-25",
  }).returning();

  const [preBalletLevel] = await dbClient.insert(balletLevelsTable).values({
    name: "Pre Ballet",
    sortOrder: 1,
    ageMin: 4,
    ageMax: 6,
    isActive: true,
  }).returning();

  const [canonicalClass] = await dbClient.insert(balletClassesTable).values({
    title: "Canonical Pre-Ballet Saturday Class",
    levelId: preBalletLevel.id,
    isActive: true,
  }).returning();

  const [schedule] = await dbClient.insert(balletSchedulesTable).values({
    classId: canonicalClass.id,
    dayOfWeek: 6,
    startTime: "10:00",
    endTime: "11:00",
    status: "active",
    capacity: 10,
  }).returning();

  const token = studentToken(student.id, student.email);

  const res = await fetch(apiUrl(`/api/ballet/available-assessment-schedules?childId=${child.id}`), {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(res.status, 200);
  const occurrences = await res.json();
  assert(Array.isArray(occurrences));
  assert.notEqual(occurrences.length, 0);

  const firstOccurrence = occurrences[0];
  assert.equal(firstOccurrence.levelId, preBalletLevel.id);
  assert.equal(firstOccurrence.levelName, "Pre Ballet");
  assert.equal(firstOccurrence.classId, canonicalClass.id);
  assert.equal(firstOccurrence.scheduleId, schedule.id);

  // Test B: Verify client attempt to fake childBirthday=2010-01-01 is ignored when childId is owned
  const fakeRes = await fetch(apiUrl(`/api/ballet/available-assessment-schedules?childId=${child.id}&childBirthday=2010-01-01`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(fakeRes.status, 200);
  const fakeOccurrences = await fakeRes.json();
  assert.equal(fakeOccurrences.length, occurrences.length); // Canonical DB birthday was used!
});

test("Real Postgres Integration: Exact 7th birthday is rejected for ageMax 6", async () => {
  const dbClient = drizzle(pool);

  const [student] = await dbClient.insert(studentsTable).values({
    name: "Parent 7Y",
    email: "parent7y@test.com",
    passwordHash: "hash",
  }).returning();

  const [child7y] = await dbClient.insert(childrenTable).values({
    parentId: student.id,
    fullName: "Seven Year Old",
    birthday: "2019-07-25",
  }).returning();

  const token = studentToken(student.id, student.email);

  const res = await fetch(apiUrl(`/api/ballet/available-assessment-schedules?childId=${child7y.id}`), {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-empty-code"), "NO_AGE_ELIGIBLE_LEVEL");
  const data = await res.json();
  assert.deepEqual(data, []);
});

test("Real Postgres Integration: Transitional duplicate & conflicting legacy table mapping", async () => {
  const dbClient = drizzle(pool);

  await pool.query("TRUNCATE ballet_applications, ballet_schedules, ballet_class_levels, ballet_classes, ballet_levels CASCADE");

  const [level1] = await dbClient.insert(balletLevelsTable).values({ name: "Level 1", sortOrder: 1, ageMin: 4, ageMax: 6, isActive: true }).returning();
  const [level2] = await dbClient.insert(balletLevelsTable).values({ name: "Level 2", sortOrder: 2, ageMin: 4, ageMax: 6, isActive: true }).returning();

  // Canonical class with direct level_id = level1.id
  const [classObj] = await dbClient.insert(balletClassesTable).values({ title: "Conflicting Class", levelId: level1.id, isActive: true }).returning();

  // Add conflicting legacy mapping in ballet_class_levels pointing to level2.id
  await dbClient.insert(balletClassLevelsTable).values({ classId: classObj.id, levelId: level2.id });

  await dbClient.insert(balletSchedulesTable).values({ classId: classObj.id, dayOfWeek: 6, startTime: "10:00", endTime: "11:00", status: "active", capacity: 10 });

  const res = await fetch(apiUrl(`/api/ballet/available-assessment-schedules?childBirthday=2019-10-25`));
  assert.equal(res.status, 200);
  const occurrences = await res.json();

  // Must match direct level1.id ONLY (conflicting legacy level2.id is completely ignored)
  assert(occurrences.length > 0);
  assert.equal(occurrences[0].levelId, level1.id);
  assert.equal(occurrences[0].levelName, "Level 1");
});

test("Real Postgres Integration: Capacity limit enforcement", async () => {
  const dbClient = drizzle(pool);

  await pool.query("TRUNCATE ballet_applications, ballet_schedules, ballet_class_levels, ballet_classes, ballet_levels, children, students CASCADE");

  const [student] = await dbClient.insert(studentsTable).values({
    name: "Cap Student",
    email: "cap@test.com",
    passwordHash: "hash",
  }).returning();

  const [level] = await dbClient.insert(balletLevelsTable).values({ name: "Level Cap", sortOrder: 1, ageMin: 4, ageMax: 6, isActive: true }).returning();
  const [classObj] = await dbClient.insert(balletClassesTable).values({ title: "Cap Class", levelId: level.id, isActive: true }).returning();
  await dbClient.insert(balletSchedulesTable).values({ classId: classObj.id, dayOfWeek: 6, startTime: "10:00", endTime: "11:00", status: "active", capacity: 1 });

  // Query occurrences
  const res1 = await fetch(apiUrl(`/api/ballet/available-assessment-schedules?childBirthday=2019-10-25`));
  const occurrences = await res1.json();
  assert(occurrences.length > 0);

  const targetOccurrence = occurrences[0];

  // Book the single available capacity slot
  await dbClient.insert(balletApplicationsTable).values({
    parentStudentId: student.id,
    parentName: student.name,
    parentPhone: "01000000000",
    parentEmail: student.email,
    childName: "Booked Child",
    childBirthday: "2019-10-25",
    assessmentScheduleId: targetOccurrence.scheduleId,
    assessmentDate: targetOccurrence.date,
    status: "pending",
  });

  // Query again: targetOccurrence.date must be excluded due to full capacity!
  const res2 = await fetch(apiUrl(`/api/ballet/available-assessment-schedules?childBirthday=2019-10-25`));
  const occurrencesAfter = await res2.json();
  const foundBookedDate = occurrencesAfter.find((o: any) => o.scheduleId === targetOccurrence.scheduleId && o.date === targetOccurrence.date);
  assert.equal(foundBookedDate, undefined);
});
