import type { PermissionMap } from "@workspace/api-zod";
import { hasRolePermission } from "@workspace/api-zod";

export interface FinancialVisibilitySubject {
  isSuperAdmin: boolean;
  permissions: PermissionMap;
}

export function canViewFinanceAmounts(subject: FinancialVisibilitySubject | null | undefined): boolean {
  return Boolean(
    subject &&
    (subject.isSuperAdmin || hasRolePermission(subject.permissions, "finance", "view")),
  );
}

export function canViewPaymentActionAmount(subject: FinancialVisibilitySubject | null | undefined): boolean {
  return Boolean(
    subject &&
    (canViewFinanceAmounts(subject) ||
      hasRolePermission(subject.permissions, "finance", "paymentsConfirm")),
  );
}

export function canViewRefundActionAmount(subject: FinancialVisibilitySubject | null | undefined): boolean {
  return Boolean(
    subject &&
    (canViewFinanceAmounts(subject) ||
      hasRolePermission(subject.permissions, "finance", "refundsManage")),
  );
}

export function redactFinancialFields<T extends object>(
  value: T,
  fields: readonly string[],
  allowed: boolean,
): T {
  if (allowed) return value;
  const result = { ...value } as unknown as Record<string, unknown>;
  for (const field of fields) {
    result[field] = null;
  }
  return result as T;
}
