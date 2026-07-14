import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  balletPaymentsTable,
  balletPackagesTable,
} from "@workspace/db";

export type BalletSubscriptionStatus = "pending" | "active" | "renewed" | "expired";

export interface BalletSubscriptionExtension {
  previousExpiresAt: string;
  newExpiresAt: string;
  daysAdded: number;
  reason: string;
  note: string | null;
  actorId: number | null;
  extendedAt: string;
}

export interface BalletPaymentCycle {
  id: number;
  applicationId: number;
  levelAssignmentId: number | null;
  packageId: number | null;
  packageName: string | null;
  amountEgp: number;
  status: string;
  paymentMethod: string | null;
  billingMonth: string | null;
  subscriptionStartDate: string | null;
  subscriptionExpiresAt: string | null;
  originalExpiresAt: string | null;
  isRenewal: boolean;
  renewedFromId: number | null;
  extensionHistory: BalletSubscriptionExtension[];
  paidAt: string | null;
  refundedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BalletPaymentCycleView extends BalletPaymentCycle {
  subscriptionStatus: BalletSubscriptionStatus;
  subscriptionDisplayStatus: string;
  hasActiveSubscription: boolean;
  daysRemaining: number | null;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayDateOnly(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addCalendarDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function diffCalendarDays(fromDateOnly: string, toDateOnly: string): number {
  const from = Date.parse(`${fromDateOnly}T00:00:00.000Z`);
  const to = Date.parse(`${toDateOnly}T00:00:00.000Z`);
  return Math.round((to - from) / 86_400_000);
}

export function defaultSubscriptionExpiresAt(startDate: string): string {
  return addCalendarDays(startDate, 30);
}

export function validateSubscriptionDates(startDate: string, expiresAt: string): string | null {
  if (!isDateOnly(startDate)) return "startDate must be a valid YYYY-MM-DD date.";
  if (!isDateOnly(expiresAt)) return "expiresAt must be a valid YYYY-MM-DD date.";
  if (diffCalendarDays(startDate, expiresAt) <= 0) return "expiresAt must be later than startDate.";
  return null;
}

export function normalizeExtensionHistory(value: unknown): BalletSubscriptionExtension[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is BalletSubscriptionExtension => {
    const row = item as Partial<BalletSubscriptionExtension>;
    return typeof row.previousExpiresAt === "string"
      && typeof row.newExpiresAt === "string"
      && typeof row.daysAdded === "number"
      && typeof row.reason === "string"
      && typeof row.extendedAt === "string";
  });
}

export function serializePaymentCycle(row: BalletPaymentCycle, today: string = todayDateOnly()): BalletPaymentCycleView {
  const hasPaidPeriod = row.status === "paid" && row.subscriptionStartDate != null && row.subscriptionExpiresAt != null;
  const daysRemaining = hasPaidPeriod ? diffCalendarDays(today, row.subscriptionExpiresAt!) : null;
  const isExpired = hasPaidPeriod && daysRemaining != null && daysRemaining < 0;
  const hasActiveSubscription = hasPaidPeriod && !isExpired;
  const subscriptionStatus: BalletSubscriptionStatus = !hasPaidPeriod
    ? "pending"
    : isExpired
      ? "expired"
      : row.isRenewal
        ? "renewed"
        : "active";

  const subscriptionDisplayStatus =
    subscriptionStatus === "pending" ? "Pending Payment"
    : subscriptionStatus === "active" ? "Active"
    : subscriptionStatus === "renewed" ? "Renewed — Active"
    : "Expired";

  return {
    ...row,
    extensionHistory: normalizeExtensionHistory(row.extensionHistory),
    subscriptionStatus,
    subscriptionDisplayStatus,
    hasActiveSubscription,
    daysRemaining: hasActiveSubscription ? Math.max(daysRemaining ?? 0, 0) : daysRemaining,
  };
}

export function currentSubscription(payments: BalletPaymentCycleView[]): BalletPaymentCycleView | null {
  const paidWithPeriod = payments.filter((payment) => payment.status === "paid" && payment.subscriptionStartDate && payment.subscriptionExpiresAt);
  if (paidWithPeriod.length > 0) {
    return paidWithPeriod
      .slice()
      .sort((a, b) => {
        const byStart = String(b.subscriptionStartDate).localeCompare(String(a.subscriptionStartDate));
        return byStart !== 0 ? byStart : b.id - a.id;
      })[0] ?? null;
  }
  return payments[0] ?? null;
}

export async function getPaymentCyclesForApplications(applicationIds: number[]): Promise<Map<number, BalletPaymentCycleView[]>> {
  const result = new Map<number, BalletPaymentCycleView[]>();
  if (applicationIds.length === 0) return result;
  const rows = await db
    .select({
      id: balletPaymentsTable.id,
      applicationId: balletPaymentsTable.applicationId,
      levelAssignmentId: balletPaymentsTable.levelAssignmentId,
      packageId: balletPaymentsTable.packageId,
      packageName: balletPackagesTable.name,
      amountEgp: balletPaymentsTable.amountEgp,
      status: balletPaymentsTable.status,
      paymentMethod: balletPaymentsTable.paymentMethod,
      billingMonth: balletPaymentsTable.billingMonth,
      subscriptionStartDate: balletPaymentsTable.subscriptionStartDate,
      subscriptionExpiresAt: balletPaymentsTable.subscriptionExpiresAt,
      originalExpiresAt: balletPaymentsTable.originalExpiresAt,
      isRenewal: balletPaymentsTable.isRenewal,
      renewedFromId: balletPaymentsTable.renewedFromId,
      extensionHistory: balletPaymentsTable.extensionHistory,
      paidAt: balletPaymentsTable.paidAt,
      refundedAt: balletPaymentsTable.refundedAt,
      notes: balletPaymentsTable.notes,
      createdAt: balletPaymentsTable.createdAt,
      updatedAt: balletPaymentsTable.updatedAt,
    })
    .from(balletPaymentsTable)
    .leftJoin(balletPackagesTable, eq(balletPackagesTable.id, balletPaymentsTable.packageId))
    .where(inArray(balletPaymentsTable.applicationId, applicationIds))
    .orderBy(desc(balletPaymentsTable.updatedAt));

  for (const row of rows) {
    const payment = serializePaymentCycle(row);
    const list = result.get(payment.applicationId) ?? [];
    list.push(payment);
    result.set(payment.applicationId, list);
  }
  return result;
}

export async function getPaymentCyclesForApplication(applicationId: number): Promise<BalletPaymentCycleView[]> {
  const rows = await getPaymentCyclesForApplications([applicationId]);
  return rows.get(applicationId) ?? [];
}

export async function getCurrentSubscriptionForApplication(applicationId: number): Promise<BalletPaymentCycleView | null> {
  return currentSubscription(await getPaymentCyclesForApplication(applicationId));
}

export async function findPaymentForApplication(paymentId: number, applicationId: number): Promise<BalletPaymentCycleView | null> {
  const [row] = await db
    .select({
      id: balletPaymentsTable.id,
      applicationId: balletPaymentsTable.applicationId,
      levelAssignmentId: balletPaymentsTable.levelAssignmentId,
      packageId: balletPaymentsTable.packageId,
      packageName: balletPackagesTable.name,
      amountEgp: balletPaymentsTable.amountEgp,
      status: balletPaymentsTable.status,
      paymentMethod: balletPaymentsTable.paymentMethod,
      billingMonth: balletPaymentsTable.billingMonth,
      subscriptionStartDate: balletPaymentsTable.subscriptionStartDate,
      subscriptionExpiresAt: balletPaymentsTable.subscriptionExpiresAt,
      originalExpiresAt: balletPaymentsTable.originalExpiresAt,
      isRenewal: balletPaymentsTable.isRenewal,
      renewedFromId: balletPaymentsTable.renewedFromId,
      extensionHistory: balletPaymentsTable.extensionHistory,
      paidAt: balletPaymentsTable.paidAt,
      refundedAt: balletPaymentsTable.refundedAt,
      notes: balletPaymentsTable.notes,
      createdAt: balletPaymentsTable.createdAt,
      updatedAt: balletPaymentsTable.updatedAt,
    })
    .from(balletPaymentsTable)
    .leftJoin(balletPackagesTable, eq(balletPackagesTable.id, balletPaymentsTable.packageId))
    .where(and(eq(balletPaymentsTable.id, paymentId), eq(balletPaymentsTable.applicationId, applicationId)))
    .limit(1);
  return row ? serializePaymentCycle(row) : null;
}
