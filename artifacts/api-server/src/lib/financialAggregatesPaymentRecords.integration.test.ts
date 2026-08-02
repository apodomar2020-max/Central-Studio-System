import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PACKAGE_CREDIT_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_package_credit";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error("Refusing non-local database");
  if (!/disposable|local|test/i.test(url.pathname)) throw new Error("Refusing database without disposable/local/test name");
  if (/rlwy\.net|railway/i.test(databaseUrl)) throw new Error("Refusing Railway database");
}
assertDisposableUrl(DATABASE_URL);

process.env.DATABASE_URL = DATABASE_URL;
process.env.API_SECRET_KEY = "test-api-secret-key";

let pool: typeof import("@workspace/db").pool;
let getFinancialAggregates: typeof import("./financialAggregates").getFinancialAggregates;

before(async () => {
  pool = (await import("@workspace/db")).pool;
  getFinancialAggregates = (await import("./financialAggregates")).getFinancialAggregates;
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await pool.end();
});

test("getFinancialAggregates prefers payment_records.paidAmountMinor over catalog price for packages", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Create a price package (catalog price 10,000 EGP)
  const pkgRes = await pool.query(
    `INSERT INTO price_packages (name, price_egp, sessions, is_active) VALUES ($1, 10000, 10, true) RETURNING id`,
    [`Pkg Override ${run}`],
  );
  const packageId = pkgRes.rows[0].id as number;

  // Create package order for package with catalog price 10,000 EGP
  const orderRes = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 10, 10, 'active') RETURNING id`,
    [`Student ${run}`, `student-${run}@example.com`, packageId, `Pkg Override ${run}`],
  );
  const packageOrderId = orderRes.rows[0].id as number;

  // Create a payment_records row with paidAmountMinor = 800,000 (8,000 EGP actual paid amount, e.g. discount)
  await pool.query(
    `INSERT INTO payment_records
       (flow_type, package_order_id, capture_origin, evidence_class, amount_availability, amount_source,
        gross_amount_minor, discount_amount_minor, final_payable_amount_minor, paid_amount_minor,
        confirmed_payment_method, status, paid_at, occurred_at)
     VALUES ('package_purchase', $1, 'live_capture', 'confirmed', 'exact', 'creation_snapshot',
             800000, 0, 800000, 800000, 'cash', 'paid', NOW(), NOW())`,
    [packageOrderId],
  );

  const aggregates = await getFinancialAggregates();

  // Clean up
  await pool.query(`DELETE FROM payment_records WHERE package_order_id = $1`, [packageOrderId]);
  await pool.query(`DELETE FROM package_orders WHERE id = $1`, [packageOrderId]);
  await pool.query(`DELETE FROM price_packages WHERE id = $1`, [packageId]);

  // Verify that the payment record amount (8,000 EGP) was used, NOT the catalog price (10,000 EGP)
  assert.ok(aggregates.grossGenericPackageRevenueEgp >= 8000);
});

test("getFinancialAggregates falls back to catalog price for legacy package orders without payment_records", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Create a price package (catalog price 5,000 EGP)
  const pkgRes = await pool.query(
    `INSERT INTO price_packages (name, price_egp, sessions, is_active) VALUES ($1, 5000, 5, true) RETURNING id`,
    [`Pkg Legacy ${run}`],
  );
  const packageId = pkgRes.rows[0].id as number;

  // Create legacy package order with NO payment_records row
  const orderRes = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 5, 5, 'active') RETURNING id`,
    [`Legacy Student ${run}`, `legacy-${run}@example.com`, packageId, `Pkg Legacy ${run}`],
  );
  const packageOrderId = orderRes.rows[0].id as number;

  const aggregates = await getFinancialAggregates();

  // Clean up
  await pool.query(`DELETE FROM package_orders WHERE id = $1`, [packageOrderId]);
  await pool.query(`DELETE FROM price_packages WHERE id = $1`, [packageId]);

  // Verify legacy fallback used 5,000 EGP catalog price
  assert.ok(aggregates.grossGenericPackageRevenueEgp >= 5000);
});

test("getFinancialAggregates excludes Ballet-linked package orders", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const pkgRes = await pool.query(
    `INSERT INTO price_packages (name, price_egp, sessions, is_active) VALUES ($1, 15000, 10, true) RETURNING id`,
    [`Pkg Ballet ${run}`],
  );
  const packageId = pkgRes.rows[0].id as number;

  const orderRes = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 10, 10, 'active') RETURNING id`,
    [`Ballet Student ${run}`, `ballet-${run}@example.com`, packageId, `Pkg Ballet ${run}`],
  );
  const packageOrderId = orderRes.rows[0].id as number;

  // Create ballet application
  const appRes = await pool.query(
    `INSERT INTO ballet_applications (parent_name, parent_phone, parent_email, child_name, status)
     VALUES ($1, $2, $3, $4, 'accepted') RETURNING id`,
    [`Parent ${run}`, `0100000000`, `parent-${run}@example.com`, `Child ${run}`],
  );
  const applicationId = appRes.rows[0].id as number;

  // Link to ballet_payments
  await pool.query(
    `INSERT INTO ballet_payments (application_id, package_order_id, amount_egp, payment_method, status, paid_at)
     VALUES ($1, $2, 15000, 'inPerson', 'paid', NOW())`,
    [applicationId, packageOrderId],
  );

  const beforeAgg = await getFinancialAggregates();

  // Clean up
  await pool.query(`DELETE FROM ballet_payments WHERE package_order_id = $1`, [packageOrderId]);
  await pool.query(`DELETE FROM ballet_applications WHERE id = $1`, [applicationId]);
  await pool.query(`DELETE FROM package_orders WHERE id = $1`, [packageOrderId]);
  await pool.query(`DELETE FROM price_packages WHERE id = $1`, [packageId]);

  const afterAgg = await getFinancialAggregates();

  // Generic package revenue should NOT change when the Ballet-linked order is removed,
  // because it was excluded from generic package revenue
  assert.equal(beforeAgg.grossGenericPackageRevenueEgp, afterAgg.grossGenericPackageRevenueEgp);
});
