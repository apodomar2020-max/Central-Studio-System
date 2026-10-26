import { createHash } from "node:crypto";
import type { Promotion, PromotionCode } from "@workspace/db";

type RevisionPromotion = Omit<Promotion, "startDate" | "endDate"> & {
  startDate: string | Date | null;
  endDate: string | Date | null;
};

export function promotionTimestampIdentity(value: string | Date | null): string | null {
  if (value == null) return null;
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    // Preserve invalid legacy strings distinctly; never collapse invalid Dates.
    if (typeof value === "string") return value;
    throw new TypeError("Invalid promotion timestamp");
  }
  // PostgreSQL retains microseconds; Date/Date.parse retain only milliseconds.
  // Keep the remaining fractional digits instead of rounding distinct DB values.
  const fraction = typeof value === "string" ? /\.(\d{1,6})(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value)?.[1] : undefined;
  const subMillisecond = fraction ? Number(fraction.padEnd(6, "0").slice(3)) : 0;
  return `instant:${BigInt(milliseconds) * 1000n + BigInt(subMillisecond)}`;
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(promotionTimestampIdentity(value));
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value != null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Configuration identity, not usage identity. Redemption counters and their
 * timestamps must not invalidate an otherwise current Admin edit. */
export function promotionRevision(promotion: RevisionPromotion, codes: PromotionCode[]): string {
  const { createdAt: _created, updatedAt: _updated, ...fields } = promotion;
  const configuration = { ...fields, startDate: promotionTimestampIdentity(fields.startDate), endDate: promotionTimestampIdentity(fields.endDate) };
  const codeConfiguration = [...codes].sort((a, b) => a.id - b.id).map(({ id, promotionId, code, maxUses, usesPerUser }) => ({ id, promotionId, code, maxUses, usesPerUser }));
  return createHash("sha256").update(canonical({ promotion: configuration, codes: codeConfiguration })).digest("hex");
}
