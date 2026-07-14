import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Response } from "express";
import type { AdminRequest } from "./adminAuth";

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

test("admin background music view requires the existing settings view permission", async () => {
  const denied = await runPermission({
    adminUser: {
      id: 1,
      sub: 1,
      username: "limited",
      fullName: "Limited",
      email: "limited@example.com",
      isSuperAdmin: false,
      roleId: 1,
      isActive: true,
      role: null,
      permissions: { settings: { edit: true } },
    },
  }, "settings", "view");
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.res.statusCode, 403);

  const allowed = await runPermission({
    adminUser: {
      id: 2,
      sub: 2,
      username: "viewer",
      fullName: "Viewer",
      email: "viewer@example.com",
      isSuperAdmin: false,
      roleId: 1,
      isActive: true,
      role: null,
      permissions: { settings: { view: true } },
    },
  }, "settings", "view");
  assert.equal(allowed.nextCalled, true);
});

test("admin background music update and URL test require settings edit permission", async () => {
  const denied = await runPermission({
    adminUser: {
      id: 1,
      sub: 1,
      username: "viewer",
      fullName: "Viewer",
      email: "viewer@example.com",
      isSuperAdmin: false,
      roleId: 1,
      isActive: true,
      role: null,
      permissions: { settings: { view: true } },
    },
  }, "settings", "edit");
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.res.statusCode, 403);

  const allowed = await runPermission({
    adminUser: {
      id: 2,
      sub: 2,
      username: "editor",
      fullName: "Editor",
      email: "editor@example.com",
      isSuperAdmin: false,
      roleId: 1,
      isActive: true,
      role: null,
      permissions: { settings: { edit: true } },
    },
  }, "settings", "edit");
  assert.equal(allowed.nextCalled, true);
});

test("admin background music requests without an admin identity are rejected", async () => {
  const denied = await runPermission({}, "settings", "view");
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.res.statusCode, 401);
});

test("public background music response exposes only mobile fields", async () => {
  const { shapeBackgroundMusicClient } = await import("./backgroundMusic");
  const shaped = shapeBackgroundMusicClient({
    id: 1,
    enabled: true,
    sourceUrl: "https://cdn.example.com/menu.mp3",
    sourceTitle: "Menu",
    volume: "0.250",
    loop: true,
    version: 4,
    updatedByAdminId: 9,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T01:00:00.000Z",
  });
  assert.deepEqual(Object.keys(shaped).sort(), ["enabled", "loop", "sourceTitle", "sourceUrl", "updatedAt", "version", "volume"]);
  assert.equal("updatedByAdminId" in shaped, false);
  assert.equal(shaped.volume, 0.25);
});
