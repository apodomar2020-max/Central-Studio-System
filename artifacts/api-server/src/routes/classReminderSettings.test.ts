import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Response } from "express";
import type { AdminIdentity, AdminRequest } from "./adminAuth";

process.env["DATABASE_URL"] ??= "postgres://localhost:1/central_studio_test";

function responseRecorder() {
  const recorder = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return recorder as unknown as Response & typeof recorder;
}

async function runPermission(req: Partial<AdminRequest>, moduleKey: string, actionKey: string) {
  const { requireAdminPermission } = await import("./adminAuth");
  const res = responseRecorder();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  requireAdminPermission(moduleKey, actionKey)(req as AdminRequest, res, next);
  return { res, nextCalled };
}

function admin(permissions: AdminIdentity["permissions"]): AdminIdentity {
  return {
    id: 1,
    sub: 1,
    username: "settings-user",
    fullName: "Settings User",
    email: "settings@example.com",
    isSuperAdmin: false,
    roleId: 1,
    isActive: true,
    role: null,
    tokenVersion: 1,
    permissions,
  };
}

test("admin class reminders view uses settings view permission", async () => {
  const denied = await runPermission({ adminUser: admin({ settings: { edit: true } }) }, "settings", "view");
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.res.statusCode, 403);

  const allowed = await runPermission({ adminUser: admin({ settings: { view: true } }) }, "settings", "view");
  assert.equal(allowed.nextCalled, true);
});

test("admin class reminders update uses settings edit permission", async () => {
  const denied = await runPermission({ adminUser: admin({ settings: { view: true } }) }, "settings", "edit");
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.res.statusCode, 403);

  const allowed = await runPermission({ adminUser: admin({ settings: { edit: true } }) }, "settings", "edit");
  assert.equal(allowed.nextCalled, true);
});

test("shapeClassReminderSettingsClient exposes only client-safe fields", async () => {
  const { shapeClassReminderSettingsClient } = await import("../lib/classReminderSettings");
  const shaped = shapeClassReminderSettingsClient({
    id: 1,
    automaticRemindersEnabled: false,
    classReminder24hEnabled: true,
    classReminder1hEnabled: false,
    postClassRating3hEnabled: true,
    updatedByAdminId: 9,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T01:00:00.000Z",
  });

  assert.deepEqual(Object.keys(shaped).sort(), [
    "automaticRemindersEnabled",
    "classReminder1hEnabled",
    "classReminder24hEnabled",
    "id",
    "postClassRating3hEnabled",
    "updatedAt",
  ]);
  assert.equal("updatedByAdminId" in shaped, false);
  assert.equal(shaped.automaticRemindersEnabled, false);
});

test("isCategoryEnabled requires both the master switch and the category switch", async () => {
  const { isCategoryEnabled } = await import("../lib/classReminderSettings");
  const base = {
    id: 1,
    updatedByAdminId: null,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
  assert.equal(
    isCategoryEnabled({ ...base, automaticRemindersEnabled: true, classReminder24hEnabled: true, classReminder1hEnabled: true, postClassRating3hEnabled: true }, "classReminder24hEnabled"),
    true,
  );
  assert.equal(
    isCategoryEnabled({ ...base, automaticRemindersEnabled: false, classReminder24hEnabled: true, classReminder1hEnabled: true, postClassRating3hEnabled: true }, "classReminder24hEnabled"),
    false,
    "master switch off must disable every category even if the category flag itself is true",
  );
  assert.equal(
    isCategoryEnabled({ ...base, automaticRemindersEnabled: true, classReminder24hEnabled: false, classReminder1hEnabled: true, postClassRating3hEnabled: true }, "classReminder24hEnabled"),
    false,
  );
});
