/** Applied attribution only: checkout selection and pricing remain authoritative. */
export function allocatePromotionDiscount(
  appliedMinor: number,
  contributions: ReadonlyArray<{ promotionId: number; weightMinor: number }>,
): Map<number, number> {
  const integer = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(
        "Promotion allocation requires nonnegative safe integer minor units",
      );
    return BigInt(value);
  };
  const applied = integer(appliedMinor);
  // Persistence has always consumed one redemption per Promotion per purchase.
  // Legacy duplicate candidates retain their combined weight and one row.
  const weights = new Map<number, bigint>();
  for (const { promotionId, weightMinor } of contributions) {
    if (!Number.isSafeInteger(promotionId) || promotionId <= 0)
      throw new Error(
        "Promotion allocation requires a stable Promotion identity",
      );
    weights.set(
      promotionId,
      (weights.get(promotionId) ?? 0n) + integer(weightMinor),
    );
  }
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0n);
  if (applied > total)
    throw new Error("Applied discount exceeds contributing discounts");
  const shares = [...weights].map(([id, weight]) => ({
    id,
    amount: total === 0n ? 0n : (applied * weight) / total,
    remainder: total === 0n ? 0n : (applied * weight) % total,
  }));
  let remaining =
    applied - shares.reduce((sum, share) => sum + share.amount, 0n);
  shares.sort((a, b) =>
    a.remainder === b.remainder
      ? a.id - b.id
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const share of shares) {
    if (remaining === 0n) break;
    share.amount += 1n;
    remaining -= 1n;
  }
  return new Map(shares.map(({ id, amount }) => [id, Number(amount)]));
}
