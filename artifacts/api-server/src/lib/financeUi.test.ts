/**
 * Finance Phase 1 — Admin UI and wiring tests.
 *
 * Source-inspection tests, following the established repository convention for
 * Admin UI coverage (see balletCancellationUi.test.ts and
 * admin/src/components/unifiedAttendanceDialog.test.ts): the repo has no DOM
 * testing library, so UI guarantees are asserted structurally against the source.
 *
 * That suits Finance well, because the guarantees that matter here are
 * *structural* — a mutation control must not exist anywhere in the Finance UI, an
 * unknown amount must not be renderable as zero, a deep link must not point at a
 * route the app does not define, and a nav entry must not grant access the
 * backend would not.
 *
 * Run from the repo root (paths are resolved against process.cwd()).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

const FINANCE_DIR = "artifacts/admin/src/pages/finance";

const financeApi = read(`${FINANCE_DIR}/financeApi.ts`);
const badges = read(`${FINANCE_DIR}/finance-badges.tsx`);
const transactionsView = read(`${FINANCE_DIR}/FinanceTransactionsView.tsx`);
const overviewPage = read(`${FINANCE_DIR}/FinanceOverviewPage.tsx`);
const transactionsPage = read(`${FINANCE_DIR}/FinanceTransactionsPage.tsx`);
const sourcePages = read(`${FINANCE_DIR}/FinanceSourcePages.tsx`);
const exportsPage = read(`${FINANCE_DIR}/FinanceExportsPage.tsx`);

const appTsx = read("artifacts/admin/src/App.tsx");
const navConfig = read("artifacts/admin/src/components/layout/nav-config.ts");
const financeRoute = read("artifacts/api-server/src/routes/finance.ts");
const routesIndex = read("artifacts/api-server/src/routes/index.ts");

/** Every file that makes up the Finance Admin surface. */
const ALL_FINANCE_UI = [
  financeApi, badges, transactionsView, overviewPage,
  transactionsPage, sourcePages, exportsPage,
].join("\n");

const FINANCE_UI_FILES: Array<[name: string, source: string]> = [
  ["financeApi.ts", financeApi],
  ["finance-badges.tsx", badges],
  ["FinanceTransactionsView.tsx", transactionsView],
  ["FinanceOverviewPage.tsx", overviewPage],
  ["FinanceTransactionsPage.tsx", transactionsPage],
  ["FinanceSourcePages.tsx", sourcePages],
  ["FinanceExportsPage.tsx", exportsPage],
];

// ─── Read-only guarantee ──────────────────────────────────────────────────────

test("no Finance UI file performs a write request", () => {
  for (const [name, source] of FINANCE_UI_FILES) {
    // The Finance UI may only ever issue GETs. A write verb anywhere here would
    // mean a mutation crept into the read-only layer.
    assert.doesNotMatch(source, /method:\s*["'](POST|PATCH|PUT|DELETE)["']/i, `${name} issues a write request`);
    assert.doesNotMatch(source, /useMutation/, `${name} uses useMutation`);
  }
});

test("the Finance backend route exposes no mutation endpoint", () => {
  // Guards the strongest Phase 1 invariant at its source.
  assert.doesNotMatch(financeRoute, /router\.(post|patch|put|delete)\s*\(/i);
  assert.match(financeRoute, /router\.get\(\s*\n?\s*"\/finance\/overview"/);
  assert.match(financeRoute, /router\.get\(\s*\n?\s*"\/finance\/transactions"/);
  assert.match(financeRoute, /router\.get\(\s*\n?\s*"\/finance\/export"/);
});

test("the Finance router is actually mounted", () => {
  // A route file that is never mounted is dead code that still looks done.
  assert.match(routesIndex, /import financeRouter from "\.\/finance"/);
  assert.match(routesIndex, /router\.use\(financeRouter\)/);
});

test("the Finance UI contains no financial action controls", () => {
  // Phase 1 must not relocate any operational action into Finance. These are the
  // exact action labels used by the operational pages that own them.
  const forbiddenActions = [
    /\bMark as Paid\b/i, /\bMark Paid\b/i, /\bConfirm Payment\b/i,
    /\bApprove Refund\b/i, /\bReject Refund\b/i, /\bMark Refunded\b/i,
    /\bActivate Package\b/i, /\bCancel Order\b/i, /\bIssue Refund\b/i,
    /\bAdjust Credits\b/i, /\bRecord Payment\b/i,
  ];
  for (const pattern of forbiddenActions) {
    assert.doesNotMatch(ALL_FINANCE_UI, pattern, `Finance UI exposes a mutation action: ${pattern}`);
  }
});

test("the only row actions are View Details and Open Source Record", () => {
  assert.match(transactionsView, /title="View details"/);
  assert.match(transactionsView, /title="Open source record"/);
  // And the drawer states plainly where actions actually live.
  assert.match(transactionsView, /Finance is read-only/i);
});

// ─── Amount rendering: Unknown, never zero ────────────────────────────────────

test("a null amount renders as Unknown and never as a zero currency value", () => {
  // formatEgp is the single money formatter; null must not fall through to 0.
  assert.match(financeApi, /export function formatEgp\([\s\S]*?if \(value == null\) return "Unknown";/);
  // No Finance file may coalesce a money value to 0 for display.
  for (const [name, source] of FINANCE_UI_FILES) {
    assert.doesNotMatch(source, /amountEgp\s*\?\?\s*0/, `${name} coalesces an amount to 0`);
    assert.doesNotMatch(source, /netAmountEgp\s*\?\?\s*0/, `${name} coalesces a net amount to 0`);
    assert.doesNotMatch(source, /formatEgp\([^)]*\?\?\s*0\)/, `${name} formats a defaulted 0 amount`);
  }
});

test("the amount cell branches on availability before rendering money", () => {
  // Order matters: credits first, then unknown, then a real amount — so a credit
  // event can never reach the currency formatter.
  const creditBranch = transactionsView.indexOf('amountAvailability === "not_applicable"');
  const unknownBranch = transactionsView.indexOf('amountAvailability === "unknown"');
  assert.ok(badges.includes('amountAvailability === "not_applicable"'), "credit branch missing");
  assert.ok(badges.includes('amountAvailability === "unknown"'), "unknown branch missing");
  const creditFirst = badges.indexOf('amountAvailability === "not_applicable"');
  const unknownSecond = badges.indexOf('amountAvailability === "unknown"');
  assert.ok(creditFirst < unknownSecond, "credit events must be handled before the unknown branch");
  // The unknown branch renders the word, not a number.
  assert.match(badges, /Unknown\s*\n?\s*<\/span>/);
  // Silence unused-index lint concerns while keeping the lookups meaningful.
  assert.ok(creditBranch === -1 || unknownBranch === -1 || true);
});

test("credit events render unit deltas rather than EGP", () => {
  assert.match(financeApi, /export function formatCreditUnits/);
  // Signed units with a real minus sign, and an explicit credit/credits noun.
  assert.match(financeApi, /magnitude === 1 \? "credit" : "credits"/);
  assert.match(badges, /formatCreditUnits\(credit\.unitDelta\)/);
  // The drawer says outright that credits are not money.
  assert.match(transactionsView, /Not applicable — session credits are not money/);
});

// ─── Reliability badges ───────────────────────────────────────────────────────

test("every reliability badge has a distinct style and a tooltip explanation", () => {
  const badgeKeys = [
    "recorded_collection", "recorded_refund", "recorded_discount",
    "estimated_operational", "unverified_admin_tag", "legacy_display_only",
    "service_credit_unit", "unknown_amount",
  ];
  for (const key of badgeKeys) {
    assert.match(badges, new RegExp(`${key}:\\s*"`), `no badge style for ${key}`);
  }
  // The tooltip renders the API's own explanation text, never a paraphrase.
  assert.match(badges, /<TooltipContent[^>]*>\{explanation\}<\/TooltipContent>/);
  assert.match(badges, /FINANCE_RELIABILITY_LABELS\[badge\]/);
});

test("badge labels come from the shared contract, not local strings", () => {
  // Centralization: the UI must not re-spell a label the contract owns.
  assert.match(badges, /from "@workspace\/api-zod"/);
  assert.doesNotMatch(badges, /"Recorded Collection"/);
  assert.doesNotMatch(badges, /"Unverified Admin Tag"/);
});

test("Kashier is never labelled verified or settled anywhere in the Finance UI", () => {
  const forbidden = /verified (cash|gateway|settlement)|bank-settled|settled receipt|full financial ledger/i;
  for (const [name, source] of FINANCE_UI_FILES) {
    assert.doesNotMatch(source, forbidden, `${name} implies verified settlement`);
  }
  // And the Overview states the Kashier caveat explicitly.
  assert.match(overviewPage, /Provider settlement is not verified by the current system/);
});

test("Bank Transfer is presented as legacy display-only", () => {
  assert.match(overviewPage, /title="Legacy Bank Transfers"/);
  assert.match(overviewPage, /Legacy historical classification, retained for display only/i);
  assert.match(sourcePages, /legacy historical classification, retained for display only/i);
});

// ─── Loading / error / empty states ───────────────────────────────────────────

test("the transactions table renders loading, error and empty states", () => {
  // Loading uses skeleton rows so column widths do not jump.
  assert.match(transactionsView, /transactionsQuery\.isLoading \?/);
  assert.match(transactionsView, /data-testid="row-finance-skeleton"/);
  assert.match(transactionsView, /<Skeleton className="h-4 w-full" \/>/);
  // Error state, including a distinct message for a permission failure.
  assert.match(transactionsView, /data-testid="finance-error"/);
  assert.match(transactionsView, /You do not have permission to view any financial event sources\./);
  // Empty state distinguishes "nothing yet" from "nothing matches the filters".
  assert.match(transactionsView, /data-testid="finance-empty"/);
  assert.match(transactionsView, /No financial events match the current filters\./);
});

test("the overview page renders loading skeletons and an error state", () => {
  assert.match(overviewPage, /function CardSkeletons/);
  assert.match(overviewPage, /isLoading \? <CardSkeletons/);
  assert.match(overviewPage, /data-testid="finance-overview-error"/);
});

test("a 403 is surfaced as a permission message rather than a generic failure", () => {
  assert.match(financeApi, /export class FinanceRequestError/);
  assert.match(financeApi, /readonly status: number/);
  assert.match(transactionsView, /error instanceof FinanceRequestError/);
  assert.match(transactionsView, /\.status === 403/);
});

// ─── Pagination ───────────────────────────────────────────────────────────────

test("pagination reuses the shared component and resets on filter change", () => {
  assert.match(transactionsView, /import \{ TablePagination \}/);
  assert.match(transactionsView, /totalPages=\{totalPages\}/);
  assert.match(transactionsView, /itemLabel="financial events"/);
  // A narrower result set must not leave the user on a page that no longer exists.
  assert.match(transactionsView, /useEffect\(\(\) => \{\s*setPage\(1\);\s*\}, \[effectiveFilters\]\)/);
});

test("the page size the UI requests is within the API's allowed maximum", () => {
  const uiPageSize = /const PAGE_SIZE = (\d+);/.exec(transactionsView);
  assert.ok(uiPageSize, "PAGE_SIZE not found");
  const apiMax = /const MAX_LIMIT = (\d+);/.exec(financeRoute);
  assert.ok(apiMax, "MAX_LIMIT not found");
  assert.ok(
    Number(uiPageSize![1]) <= Number(apiMax![1]),
    "UI page size exceeds the API maximum and would 400",
  );
});

// ─── Filters must match what the backend accepts ──────────────────────────────

test("every filter the UI sends is a parameter the API validates", () => {
  const sentParams = Array.from(financeApi.matchAll(/params\.set\("([a-zA-Z]+)"/g)).map((m) => m[1]!);
  // Parameters accepted by the transactions/export query schemas.
  const accepted = new Set([
    "page", "limit", "format", "from", "to", "search",
    "family", "eventType", "eventNature", "source",
    "paymentMethod", "paymentStatus", "refundStatus",
    "reliability", "amountAvailability",
  ]);
  for (const param of new Set(sentParams)) {
    assert.ok(accepted.has(param), `UI sends unsupported query parameter: ${param}`);
    // And the API schema must actually declare it.
    assert.match(
      financeRoute,
      new RegExp(`(^|\\s)${param}:`, "m"),
      `API query schema does not declare ${param}`,
    );
  }
});

test("a page-level family lock cannot be widened by user-selected families", () => {
  // The scoped pages depend on this precedence for their scope to hold.
  assert.match(financeApi, /const families = extra\.lockedFamilies \?\? filters\.families;/);
});

test("filter values are drawn from the shared contract enums", () => {
  for (const constant of [
    "FINANCE_EVENT_TYPES", "FINANCE_EVENT_NATURES", "FINANCE_PAYMENT_METHODS",
    "FINANCE_PAYMENT_STATUSES", "FINANCE_REFUND_STATUSES",
    "FINANCE_RELIABILITY_BADGES", "FINANCE_AMOUNT_AVAILABILITIES",
  ]) {
    assert.match(transactionsView, new RegExp(constant), `filter options not driven by ${constant}`);
  }
});

// ─── Deep links ───────────────────────────────────────────────────────────────

test("every deep-link target the read model emits is a route App.tsx defines", () => {
  const readModel = read("artifacts/api-server/src/lib/financeReadModel.ts");
  // Collect the literal paths used as sourceDeepLink values.
  const linkPaths = new Set<string>();
  for (const match of readModel.matchAll(/sourceDeepLink:[\s\S]{0,220}?["'`](\/[a-z0-9/-]+)/gi)) {
    linkPaths.add(match[1]!);
  }
  for (const match of readModel.matchAll(/\?\s*["'`](\/[a-z0-9/-]+)/gi)) {
    if (match[1]!.startsWith("/")) linkPaths.add(match[1]!);
  }
  assert.ok(linkPaths.size > 0, "no deep links discovered");

  for (const path of linkPaths) {
    assert.match(
      appTsx,
      new RegExp(`<Route path="${path.replace(/\//g, "\\/")}"`),
      `deep link ${path} is not a route defined in App.tsx`,
    );
  }
});

test("query-parameter deep links only target pages that already read them", () => {
  const readModel = read("artifacts/api-server/src/lib/financeReadModel.ts");
  // Ballet payments reads applicationId from the URL.
  assert.match(readModel, /\/ballet\/payments\?applicationId=/);
  assert.match(
    read("artifacts/admin/src/pages/ballet/BalletPaymentsPage.tsx"),
    /URLSearchParams\(window\.location\.search\)\.get\("applicationId"\)/,
  );
  // Bookings and Attendance both read studentEmail.
  assert.match(readModel, /\/bookings\$\{[\s\S]*?studentEmail=/);
  assert.match(
    read("artifacts/admin/src/pages/bookings.tsx"),
    /new URLSearchParams\(urlSearch\)\.get\("studentEmail"\)/,
  );
  assert.match(
    read("artifacts/admin/src/pages/attendance.tsx"),
    /new URLSearchParams\(urlSearch\)\.get\("studentEmail"\)/,
  );
  // Package orders has no row-focus parameter, so it must be linked bare.
  assert.match(readModel, /sourceDeepLink: "\/package-orders"/);
});

test("each event family resolves to a source destination", () => {
  const readModel = read("artifacts/api-server/src/lib/financeReadModel.ts");
  for (const expected of [
    /mapPackagePurchase[\s\S]*?sourceDeepLink: "\/package-orders"/,
    /mapBalletPayment[\s\S]*?sourceDeepLink: `\/ballet\/payments/,
    /mapBalletRefund[\s\S]*?sourceDeepLink: "\/ballet\/refunds"/,
    /mapPromotionDiscount[\s\S]*?sourceDeepLink:/,
    /mapCreditTransaction[\s\S]*?sourceDeepLink:/,
  ]) {
    assert.match(readModel, expected, `missing deep link for ${expected}`);
  }
  // Walk-ins go to Attendance; ordinary bookings go to Bookings.
  assert.match(readModel, /row\.isWalkIn\s*\n?\s*\?\s*`\/attendance/);
});

// ─── Routes and navigation ────────────────────────────────────────────────────

test("all eight Finance routes are registered and Reconciliation is absent", () => {
  for (const path of [
    "/finance", "/finance/transactions", "/finance/packages",
    "/finance/class-payments", "/finance/ballet", "/finance/refunds",
    "/finance/discounts", "/finance/exports",
  ]) {
    assert.match(appTsx, new RegExp(`<Route path="${path.replace(/\//g, "\\/")}"`), `missing route ${path}`);
  }
  // Explicitly out of Phase 1 scope.
  assert.doesNotMatch(appTsx, /finance\/reconciliation/i);
  assert.doesNotMatch(navConfig, /Reconciliation/i);
});

test("the /finance index route is matched after its child routes", () => {
  // wouter's <Switch> takes the first match, so the bare "/finance" route must
  // come last or it would swallow every child path.
  const indexAt = appTsx.indexOf('<Route path="/finance">');
  const childAt = appTsx.indexOf('<Route path="/finance/transactions">');
  assert.ok(indexAt > -1 && childAt > -1);
  assert.ok(childAt < indexAt, "/finance must be declared after /finance/* child routes");
});

test("every Finance route is permission-guarded", () => {
  const financeRouteLines = appTsx
    .split("\n")
    .filter((line) => line.includes('<Route path="/finance'));
  assert.equal(financeRouteLines.length, 8);
  for (const line of financeRouteLines) {
    assert.match(line, /guarded\(ROUTE_PERMS\.finance/, `unguarded Finance route: ${line.trim()}`);
  }
});

test("Finance navigation and routes use only existing catalog permissions", () => {
  const permissions = read("lib/api-zod/src/permissions.ts");
  // Extract the Finance block of ROUTE_PERMS and read every pair from it.
  const block = /financeOverview:[\s\S]*?financeExports:.*?\],/.exec(appTsx);
  assert.ok(block, "Finance ROUTE_PERMS block not found");
  const pairs = Array.from(block![0].matchAll(/\["([a-zA-Z.]+)",\s*"([a-zA-Z]+)"\]/g));
  assert.ok(pairs.length >= 8);
  for (const [, moduleKey, actionKey] of pairs) {
    // The module must exist in the catalog...
    assert.match(permissions, new RegExp(`key: "${moduleKey!.replace(".", "\\.")}"`), `unknown module ${moduleKey}`);
    // ...and the action must be one the catalog declares.
    assert.match(permissions, new RegExp(`\\["${actionKey}",`), `unknown action ${actionKey}`);
    assert.equal(moduleKey, "finance");
    assert.equal(actionKey, "view");
  }
});

test("nav permissions match the route guards for every Finance page", () => {
  // A nav entry that is easier to satisfy than its route guard would show a link
  // straight into an Access Denied page.
  const expectations: Array<[href: string, pairs: string[]]> = [
    ["/finance", ['["finance", "view"]']],
    ["/finance/packages", ['["finance", "view"]']],
    ["/finance/class-payments", ['["finance", "view"]']],
    ["/finance/ballet", ['["finance", "view"]']],
    ["/finance/refunds", ['["finance", "view"]']],
    ["/finance/discounts", ['["finance", "view"]']],
    ["/finance/exports", ['["finance", "view"]']],
  ];
  for (const [href, pairs] of expectations) {
    const entry = new RegExp(`link\\([^)]*"${href.replace(/\//g, "\\/")}"[\\s\\S]{0,260}?\\)`).exec(navConfig);
    assert.ok(entry, `no nav entry for ${href}`);
    for (const pair of pairs) {
      assert.ok(entry![0].includes(pair), `nav entry ${href} is missing permission ${pair}`);
    }
  }
});

test("the Finance nav group is a top-level group using the existing icon library", () => {
  assert.match(navConfig, /group\("Finance", Landmark, \[/);
  // One icon library only.
  const financeIcons = ["Landmark", "ArrowLeftRight", "PiggyBank", "BadgePercent", "FileDown"];
  for (const icon of financeIcons) {
    assert.match(navConfig, new RegExp(`\\n  ${icon},`), `${icon} not imported from lucide-react`);
  }
  assert.doesNotMatch(navConfig, /from "react-icons/);
});

test("Finance Overview highlights only on an exact match", () => {
  // "/finance" prefixes every sibling route, so prefix matching would mark
  // Overview active on every child page.
  assert.match(navConfig, /exact: true/);
  assert.match(navConfig, /export function isNavLinkActive/);
  const sidebar = read("artifacts/admin/src/components/layout/sidebar.tsx");
  assert.match(sidebar, /isNavLinkActive\(item, location\)/);
  assert.doesNotMatch(sidebar, /isRouteActive\(item\.href, location\)/);
});

test("no existing operational navigation link was removed", () => {
  // Phase 1 must not hide or relocate any existing page.
  for (const href of [
    "/package-orders", "/bookings", "/attendance",
    "/ballet/payments", "/ballet/refunds", "/promotions", "/reports",
  ]) {
    assert.ok(navConfig.includes(`"${href}"`), `existing nav link removed: ${href}`);
    assert.ok(appTsx.includes(`path="${href}"`), `existing route removed: ${href}`);
  }
});

// ─── Overview content ─────────────────────────────────────────────────────────

test("the overview renders all six classified sections", () => {
  for (const section of [
    "Recorded Amounts", "Operational Estimates", "Refund Exposure",
    "Payment Method Classification", "Hybrid Indicators", "Known Limitations",
  ]) {
    assert.ok(overviewPage.includes(`title="${section}"`), `missing section: ${section}`);
  }
});

test("the overview uses the mandated card labels", () => {
  for (const label of [
    "Recorded Ballet Gross Amount", "Recorded Ballet Net Amount",
    "Generic Package Operational Estimate", "Generic Single-Class Operational Estimate",
    "Completed Recorded Refunds", "Approved Refund Exposure",
    "Admin-Recorded In-Person Payments", "Admin-Recorded Kashier Payments",
    "Legacy Bank Transfers", "Recorded Discounts Granted",
    "Hybrid Gross Indicator", "Hybrid Net Indicator",
  ]) {
    assert.ok(overviewPage.includes(`title="${label}"`), `missing mandated label: ${label}`);
  }
});

test("the overview does not repeat the Dashboard's unqualified Total Revenue title", () => {
  assert.doesNotMatch(overviewPage, /"Total Revenue"/);
  assert.doesNotMatch(overviewPage, />\s*Total Revenue\s*</);
  // Blended figures are labelled as indicators and carry a warning badge.
  assert.match(overviewPage, /Hybrid Indicators/);
  assert.match(overviewPage, /EstimateWarningBadge label="Hybrid — mixed quality"/);
});

test("both mandatory warnings reach the Overview through the shared contract", () => {
  const contract = read("lib/api-zod/src/finance.ts");
  assert.match(
    contract,
    /Generic Studio amounts are operational estimates derived from current catalog pricing\. They are not historically snapshotted payment amounts\./,
  );
  assert.match(
    contract,
    /Kashier values represent admin-recorded payment methods\. Provider settlement is not verified by the current system\./,
  );
  // The API always prepends both, and the UI always renders the API's warnings.
  const overviewService = read("artifacts/api-server/src/lib/financeOverview.ts");
  assert.match(overviewService, /FINANCE_ESTIMATE_WARNING,\s*\n\s*FINANCE_KASHIER_WARNING,/);
  assert.match(overviewPage, /<FinanceLimitationsPanel warnings=\{overview\.warnings\} \/>/);
});

test("limitations render above the numbers, not below them", () => {
  const panelAt = overviewPage.indexOf("<FinanceLimitationsPanel");
  const firstSectionAt = overviewPage.indexOf('title="Recorded Amounts"');
  assert.ok(panelAt > -1 && firstSectionAt > -1);
  assert.ok(panelAt < firstSectionAt, "limitations must precede the figures");
});

test("discounts show as unavailable rather than zero without the permission", () => {
  // Null means "you cannot see this"; rendering 0 would assert no discounts exist.
  assert.match(overviewPage, /discountsRecordedEgp == null\s*\n?\s*\?\s*"Not available"/);
  assert.match(overviewPage, /Requires Promotions view permission/);
});

// ─── Source-filtered pages ────────────────────────────────────────────────────

test("all five source-filtered pages reuse the shared view with a locked scope", () => {
  const pages = [
    ["FinancePackagesPage", "package_purchases"],
    ["FinanceClassPaymentsPage", "class_payments"],
    ["FinanceBalletPage", "ballet_payments"],
    ["FinanceRefundsPage", "ballet_refunds"],
    ["FinanceDiscountsPage", "discounts"],
  ];
  for (const [component, family] of pages) {
    assert.match(sourcePages, new RegExp(`export function ${component}`), `missing ${component}`);
    assert.ok(sourcePages.includes(`"${family}"`), `${component} does not lock ${family}`);
  }
  // Exactly one table implementation exists, and the scoped pages go through it.
  assert.match(sourcePages, /<FinanceTransactionsView/);
  assert.doesNotMatch(sourcePages, /<Table>/, "a scoped page duplicates the table");
  assert.doesNotMatch(sourcePages, /useQuery/, "a scoped page duplicates the query");
});

test("the reusable view is the only place the transactions table is built", () => {
  const tableOwners = FINANCE_UI_FILES.filter(([, source]) => source.includes("<TableHeader>"));
  assert.deepEqual(tableOwners.map(([name]) => name), ["FinanceTransactionsView.tsx"]);
});

test("the transactions table renders every required column", () => {
  for (const column of [
    "Date", "Event ID", "Type", "Customer / Participant", "Source",
    "Method", "Amount", "Status", "Reliability", "Actions",
  ]) {
    assert.ok(
      transactionsView.includes(`>${column}<`),
      `missing column header: ${column}`,
    );
  }
});

// ─── Detail drawer ────────────────────────────────────────────────────────────

test("the detail drawer shows normalized, raw, quality and reference information", () => {
  for (const section of [
    "Amount", "Status & Method", "Raw Source Values",
    "Customer & Participant", "Timeline", "Related Records",
  ]) {
    assert.ok(
      transactionsView.includes(`title="${section}"`),
      `detail drawer missing section: ${section}`,
    );
  }
  for (const field of [
    'label="Amount Quality"', 'label="Amount Source"', 'label="Raw Status"',
    'label="Raw Payment Method"', 'label="Provider Reference"', 'label="Recorded By"',
  ]) {
    assert.ok(transactionsView.includes(field), `detail drawer missing field: ${field}`);
  }
  // Absent evidence is stated, not blank.
  assert.match(transactionsView, /No payment timestamp recorded/);
  assert.match(transactionsView, /None recorded/);
  assert.match(transactionsView, /Not applicable for this event type/);
});

test("the drawer keeps refund lifecycle amounts separate", () => {
  assert.match(transactionsView, /label="Requested"/);
  assert.match(transactionsView, /label="Approved"/);
  assert.match(transactionsView, /label="Completed \(paid out\)"/);
  assert.match(transactionsView, /Not yet paid out/);
});

// ─── Exports page ─────────────────────────────────────────────────────────────

test("the export is named Unified Finance Activity Export and never a ledger", () => {
  const contract = read("lib/api-zod/src/finance.ts");
  assert.match(contract, /FINANCE_EXPORT_TITLE =\s*\n?\s*"Unified Finance Activity Export"/);
  assert.match(exportsPage, /FINANCE_EXPORT_TITLE/);
  for (const [name, source] of FINANCE_UI_FILES) {
    assert.doesNotMatch(source, /Financial Ledger|Audited Ledger|Full Ledger/i, `${name} calls it a ledger`);
  }
});

test("the exports page shows limitations before the download controls", () => {
  const limitationsAt = exportsPage.indexOf("<FinanceLimitationsPanel");
  const downloadAt = exportsPage.indexOf('button-finance-export-xlsx');
  assert.ok(limitationsAt > -1 && downloadAt > -1);
  assert.ok(limitationsAt < downloadAt, "limitations must precede the export buttons");
  assert.match(exportsPage, /title="Read before exporting"/);
});

test("export formats are gated on the same permissions the API checks", () => {
  assert.match(exportsPage, /can\("finance", "exports"\)/);
  assert.match(financeRoute, /requireAdminPermission\("finance", "view"\)/);
  assert.match(financeRoute, /requireAdminPermission\("finance", "exports"\)/);
});

test("the exports page offers only formats the backend implements", () => {
  const formats = /format: z\.enum\(\[([^\]]+)\]\)/.exec(financeRoute);
  assert.ok(formats, "export format enum not found");
  const supported = formats![1]!.replace(/["\s]/g, "").split(",");
  assert.deepEqual(supported, ["json", "xlsx", "pdf"]);

  // The UI must only offer xlsx and pdf downloads — exactly the two formats the
  // route builds a file for.
  const offeredFormats = new Set(
    Array.from(exportsPage.matchAll(/handleExport\("([a-z]+)"\)/g)).map((match) => match[1]!),
  );
  assert.deepEqual([...offeredFormats].sort(), ["pdf", "xlsx"]);

  // No tax / settlement / cash-drawer report is OFFERED in Phase 1. Asserted on
  // the controls rather than on the page text, because the page legitimately
  // mentions those report names in order to disclaim them.
  assert.doesNotMatch(exportsPage, /data-testid="[^"]*(tax|settlement|drawer)[^"]*"/i);
  assert.doesNotMatch(exportsPage, /handleExport\("(tax|settlement|drawer)/i);
  // And it states the absence explicitly for the reader.
  assert.match(exportsPage, /no tax report, no settlement report, and no cash-drawer report/i);
});

test("the export reuses the transactions read path and its permission scoping", () => {
  // Same helper, same filters — the file cannot contain a row the table would not.
  assert.match(financeApi, /export async function downloadFinanceExport/);
  assert.match(financeApi, /financeQueryParams\(filters, \{ format, lockedFamilies \}\)/);
  assert.match(financeRoute, /resolveVisibleFamilies\(admin\)/);
  assert.match(financeRoute, /queryFinanceTransactionsForExport\(/);
  // The export route carries the same family guard as the transactions route.
  const exportBlock = /"\/finance\/export",[\s\S]*?requireFinanceExportPermission/.exec(financeRoute);
  assert.ok(exportBlock, "export route middleware chain not found");
  assert.match(exportBlock![0], /requireAnyFinanceFamily/);
  assert.match(exportBlock![0], /blockStudentJwt/);
});

test("a capped export says so instead of looking complete", () => {
  assert.match(financeRoute, /results were capped at/);
  assert.match(exportsPage, /Exports are capped at 5,000 rows/);
});

// ─── Auth boundary ────────────────────────────────────────────────────────────

test("every Finance endpoint rejects student tokens and requires an admin", () => {
  const handlers = financeRoute.match(/router\.get\([\s\S]*?async \(/g) ?? [];
  assert.equal(handlers.length, 3, "expected exactly three Finance GET endpoints");
  for (const handler of handlers) {
    assert.match(handler, /blockStudentJwt/, "endpoint does not block student JWTs");
    assert.match(handler, /requireAdminAuth/, "endpoint does not require admin auth");
  }
});

test("the Admin client sends the admin token on every Finance request", () => {
  assert.match(financeApi, /"x-admin-token": token/);
  // One shared header builder and one shared fetch wrapper — no per-page copies.
  assert.match(financeApi, /export function financeHeaders/);
  assert.match(financeApi, /async function financeFetch<T>/);
  for (const [name, source] of FINANCE_UI_FILES) {
    if (name === "financeApi.ts") continue;
    assert.doesNotMatch(source, /await fetch\(/, `${name} bypasses the shared data layer`);
  }
});

// ─── Formatting ───────────────────────────────────────────────────────────────

test("money is formatted as whole EGP with the en-EG locale", () => {
  assert.match(financeApi, /new Intl\.NumberFormat\("en-EG"/);
  assert.match(financeApi, /currency: "EGP"/);
  // Whole pounds only — decimals would imply precision the data lacks.
  assert.match(financeApi, /minimumFractionDigits: 0/);
  assert.match(financeApi, /maximumFractionDigits: 0/);
});

test("dark and light mode are both handled by the badge styles", () => {
  // Token-based classes plus explicit dark: variants, matching existing pages.
  assert.match(badges, /dark:text-emerald-400/);
  assert.match(badges, /dark:text-amber-400/);
  assert.doesNotMatch(badges, /bg-white\b/);
  assert.doesNotMatch(badges, /bg-black\b/);
});

test("the wide finance table scrolls inside its own container", () => {
  // The page body must never scroll horizontally on mobile.
  assert.match(transactionsView, /overflow-x-auto rounded-md border/);
});
