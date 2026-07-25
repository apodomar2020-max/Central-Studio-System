/**
 * Minor-unit (piastre) money conversion for Finance Phase 2.
 *
 * EGP amounts are converted to/from integer minor units (1 EGP = 100 minor
 * units) at exactly one boundary: `egpToMinor` is the single place a
 * rounding decision is made in the whole conversion, using the same
 * Math.round(value * 100) boundary as promotionService.ts's existing
 * roundMoney() (Math.round(value * 100) / 100) — deliberately matched so a
 * price already rounded by roundMoney() converts to minor units without a
 * second, independent rounding decision disagreeing with the first.
 * `minorToEgp` never rounds — once a value is captured in minor units it is
 * exact, and division back to EGP is a pure, lossless operation.
 *
 * Unit conversion only: no formatting, no currency conversion, no display
 * logic. Callers needing a display string round-trip through
 * financeReadModel.ts / financeExport.ts, not this module.
 */

export class MoneyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyValidationError";
  }
}

function assertFiniteNumber(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MoneyValidationError(`${label} must be a finite number, got ${String(value)}`);
  }
}

function assertNonNegative(value: number, label: string): void {
  if (value < 0) {
    throw new MoneyValidationError(`${label} must not be negative, got ${value}`);
  }
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyValidationError(
      `${label} must be within JavaScript's safe integer range, got ${value}`,
    );
  }
}

/**
 * Converts a decimal EGP amount to integer minor units (piastres).
 *
 * The single rounding boundary for this whole conversion pipeline —
 * Math.round(amountEgp * 100), matching promotionService.ts's roundMoney()
 * multiplier exactly. Rejects negative or non-finite input, and rejects a
 * result that would fall outside Number.MAX_SAFE_INTEGER.
 */
export function egpToMinor(amountEgp: number): number {
  assertFiniteNumber(amountEgp, "amountEgp");
  assertNonNegative(amountEgp, "amountEgp");

  const minor = Math.round(amountEgp * 100);

  assertSafeInteger(minor, "egpToMinor result");
  return minor;
}

/**
 * Converts integer minor units (piastres) back to decimal EGP.
 *
 * Pure division — never rounds. amountMinor must already be a non-negative,
 * finite, safe integer; a non-integer minor-unit value is rejected rather
 * than silently truncated or rounded, since a fractional minor unit can
 * never legitimately occur in captured data.
 */
export function minorToEgp(amountMinor: number): number {
  assertFiniteNumber(amountMinor, "amountMinor");
  assertNonNegative(amountMinor, "amountMinor");

  if (!Number.isInteger(amountMinor)) {
    throw new MoneyValidationError(`amountMinor must be an integer, got ${amountMinor}`);
  }
  assertSafeInteger(amountMinor, "amountMinor");

  return amountMinor / 100;
}
