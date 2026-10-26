/** Built Admin -> real authenticated HTTP -> real newly disposable PostgreSQL. */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
const require = createRequire(import.meta.url),
  apiRequire = createRequire(path.resolve("artifacts/api-server/package.json"));
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const { Pool } = createRequire(path.resolve("lib/db/package.json"))("pg"),
  jwt = apiRequire("jsonwebtoken");
const url = process.env.DISPOSABLE_PROMOTIONS_BROWSER_DATABASE_URL,
  preview = process.env.PROMOTIONS_ADMIN_TEST_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  !/disposable/.test(new URL(url).pathname) ||
  !preview ||
  !["localhost", "127.0.0.1"].includes(new URL(preview).hostname)
)
  throw Error("Explicit disposable local database and preview required");
let pool, browser, child, api, token, adminId;
const secret = "browser-fullstack-disposable-secret";
before(async () => {
  pool = new Pool({ connectionString: url });
  adminId = (
    await pool.query(
      "insert into system_users(username,email,password_hash,full_name,is_super_admin) values($1,$2,'unused','Browser Admin',true) returning id",
      [`browser-${randomUUID()}`, `browser-${randomUUID()}@example.invalid`],
    )
  ).rows[0].id;
  token = jwt.sign({ sub: adminId, tokenVersion: 1 }, secret);
  child = fork(
    path.resolve(
      "artifacts/api-server/src/test-fixtures/promotionOperationServer.ts",
    ),
    [],
    {
      execArgv: [
        "--import",
        path.resolve("lib/db/node_modules/tsx/dist/loader.mjs"),
      ],
      env: {
        ...process.env,
        DATABASE_URL: url,
        ADMIN_JWT_SECRET: secret,
        NODE_ENV: "test",
        REDIS_URL: "",
        BREVO_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  child.stdout.resume();
  let stderr = "";
  child.stderr.on("data", (b) => (stderr += b));
  api = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(stderr)), 15000);
    child.once("message", (m) => {
      clearTimeout(timer);
      resolve(`http://127.0.0.1:${m.port}`);
    });
    child.once("exit", () => reject(Error(stderr)));
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PROMOTIONS_TEST_CHROME
      ? { executablePath: process.env.PROMOTIONS_TEST_CHROME }
      : {}),
  });
});
after(async () => {
  await browser?.close();
  if (child && child.exitCode === null)
    await new Promise((r) => {
      child.once("exit", r);
      child.kill("SIGTERM");
    });
  await pool?.end();
});
async function fixture(drop = false) {
  const context = await browser.newContext(),
    page = await context.newPage(),
    writes = [],
    errors = [];
  let delivered = false;
  await context.addInitScript(
    (t) => localStorage.setItem("admin_jwt", t),
    token,
  );
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("**/*", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (u.origin !== new URL(preview).origin) return route.abort();
    if (!u.pathname.startsWith("/api/")) return route.continue();
    if (req.method() !== "GET")
      writes.push({
        key: req.headers()["idempotency-key"],
        body: req.postData(),
        method: req.method(),
      });
    const response = await route.fetch({
      url: `${api}${u.pathname}${u.search}`,
    });
    if (drop && !delivered && req.method() !== "GET") {
      delivered = true;
      await response.dispose();
      return route.abort("connectionclosed");
    }
    return route.fulfill({ response });
  });
  await page.goto(`${preview}/promotions`);
  await page
    .getByRole("button", { name: "Add Promotion", exact: true })
    .waitFor();
  return { context, page, writes, errors };
}
test("full stack: lost committed automatic-create response survives reload and reconciles once", async () => {
  const f = await fixture(true),
    name = `Full stack lost ${randomUUID()}`;
  try {
    await f.page
      .getByRole("button", { name: "Add Promotion", exact: true })
      .click();
    let dialog = f.page.getByRole("dialog");
    await dialog.locator("input").first().fill(name);
    await dialog
      .getByRole("button", { name: "Save Promotion", exact: true })
      .click();
    await dialog
      .getByRole("alert")
      .filter({ hasText: /could not be confirmed/ })
      .waitFor();
    const stored = (
      await pool.query(
        "select * from promotion_admin_operations where operation_id=$1",
        [f.writes[0].key],
      )
    ).rows[0];
    assert.equal(stored.state, "succeeded");
    assert.equal(stored.actor_admin_id, adminId);
    await f.page.reload();
    dialog = f.page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(await dialog.locator("input").first().inputValue(), name);
    await dialog
      .getByRole("button", { name: "Check previous save", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await f.page
      .getByRole("button", { name: `Edit promotion ${name}`, exact: true })
      .waitFor();
    assert.equal(f.writes.length, 1);
    assert.equal(
      Number(
        (
          await pool.query("select count(*) from promotions where name=$1", [
            name,
          ])
        ).rows[0].count,
      ),
      1,
    );
    assert.equal(
      Number(
        (
          await pool.query(
            "select count(*) from promotion_audit_logs where promotion_id=$1",
            [stored.result_promotion_id],
          )
        ).rows[0].count,
      ),
      1,
    );
    assert.equal(
      Number(
        (
          await pool.query(
            "select count(*) from admin_activity_logs where module='promotions' and entity_id=$1",
            [stored.result_promotion_id],
          )
        ).rows[0].count,
      ),
      1,
    );
    assert.deepEqual(f.errors, []);
    if (process.env.PROMOTIONS_BROWSER_SCREENSHOT)
      await f.page.screenshot({
        path: process.env.PROMOTIONS_BROWSER_SCREENSHOT,
        fullPage: true,
      });
  } finally {
    await f.context.unrouteAll({ behavior: "wait" });
    await f.context.close();
  }
});
test("full stack: successful edit and deactivation use durable identities and current revisions", async () => {
  const name = `Full stack edit ${randomUUID()}`;
  const res = await fetch(`${api}/api/promotions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": token,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      name,
      type: "automatic",
      discountValue: 10,
      isActive: true,
    }),
  });
  assert.equal(res.status, 201);
  const p = await res.json();
  const f = await fixture();
  try {
    await f.page
      .getByRole("button", { name: `Edit promotion ${name}`, exact: true })
      .click();
    const dialog = f.page.getByRole("dialog");
    await dialog.locator("input").first().fill(`${name} changed`);
    await dialog
      .getByRole("button", { name: "Save Promotion", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await f.page
      .getByRole("button", {
        name: `Deactivate promotion ${name} changed`,
        exact: true,
      })
      .click();
    const deleted = f.page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/promotions/${p.id}`) &&
        r.request().method() === "DELETE" &&
        r.status() === 204,
    );
    await f.page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Deactivate", exact: true })
      .click();
    await deleted;
    await f.page
      .getByRole("button", {
        name: `Deactivate promotion ${name} changed`,
        exact: true,
      })
      .waitFor({ state: "hidden" });
    assert.equal(f.writes.length, 2);
    assert.notEqual(f.writes[0].key, f.writes[1].key);
    assert.equal(
      (await pool.query("select is_active from promotions where id=$1", [p.id]))
        .rows[0].is_active,
      false,
    );
    assert.deepEqual(
      (
        await pool.query(
          "select state from promotion_admin_operations where operation_id=any($1::uuid[])",
          [f.writes.map((w) => w.key)],
        )
      ).rows.map((r) => r.state),
      ["succeeded", "succeeded"],
    );
    assert.deepEqual(f.errors, []);
  } finally {
    await f.context.unrouteAll({ behavior: "wait" });
    await f.context.close();
  }
});

test("full stack: simplified manual creation and unused-code rename preserve identity, rules, limits and audits", async () => {
  const f = await fixture(), name = `UX manual ${randomUUID()}`, code = `UX${randomUUID().replaceAll("-", "").slice(0,12).toUpperCase()}`;
  try {
    await f.page.getByRole("button", {name:"Add Promotion",exact:true}).click();
    let d = f.page.getByRole("dialog");
    await d.getByLabel("Promotion name",{exact:true}).fill(name);
    await d.getByLabel("How customers receive it").click(); await f.page.getByRole("option",{name:"Promo code",exact:true}).click();
    await d.getByLabel("Promo code",{exact:true}).fill(code);
    await d.getByRole("switch",{name:"Verified students only",exact:true}).check();
    await d.getByRole("button",{name:/Additional settings/}).click();
    await d.getByLabel("Total promotion redemptions").fill("5");await d.getByLabel("Total code uses").fill("3");await d.getByLabel("Code uses per customer").fill("1");
    await d.getByRole("button",{name:"Save Promotion",exact:true}).click();await d.waitFor({state:"hidden"});
    const original=(await pool.query("select p.id,p.rules_config,c.id as code_id,c.max_uses,c.uses_per_user from promotions p join promotion_codes c on c.promotion_id=p.id where p.name=$1",[name])).rows[0];
    assert.deepEqual(original.rules_config,{verifiedStudentOnly:true,maxGlobalUses:5});assert.equal(original.max_uses,3);assert.equal(original.uses_per_user,1);
    await f.page.getByRole("button",{name:`Edit promotion ${name}`,exact:true}).click();d=f.page.getByRole("dialog");
    await d.getByLabel("Promo code",{exact:true}).fill(`${code}R`);await d.getByRole("button",{name:"Save Promotion",exact:true}).click();await d.waitFor({state:"hidden"});
    const renamed=(await pool.query("select id,promotion_id,code,max_uses,uses_per_user,current_uses from promotion_codes where promotion_id=$1",[original.id])).rows;
    assert.equal(renamed.length,1);assert.equal(renamed[0].id,original.code_id);assert.equal(renamed[0].promotion_id,original.id);assert.equal(renamed[0].code,`${code}R`);assert.equal(renamed[0].max_uses,3);assert.equal(renamed[0].uses_per_user,1);assert.equal(renamed[0].current_uses,0);
    assert.equal(f.writes.length,2);assert.notEqual(f.writes[0].key,f.writes[1].key);
    assert.deepEqual((await pool.query("select action,entity_type from admin_activity_logs where module='promotions' and ((entity_type='promotion' and entity_id=$1) or (entity_type='promotion_code' and entity_id=$2)) order by id",[original.id,original.code_id])).rows,[{action:"create",entity_type:"promotion"},{action:"create",entity_type:"promotion_code"},{action:"update",entity_type:"promotion_code"}]);
    assert.deepEqual((await pool.query("select action from promotion_audit_logs where promotion_id=$1 order by id",[original.id])).rows.map(r=>r.action),["promotion.created","promotion.updated"]);
    assert.deepEqual(f.errors,[]);
  } finally {await f.context.unrouteAll({behavior:"wait"});await f.context.close();}
});
