/** The entered code activates evaluation; quote.promotionCode describes the
 * selected discount and can be null when an Automatic candidate wins. */
export function bookingPromoActivationCode(
  paymentMode: string,
  enteredCode: string,
): string | undefined {
  return paymentMode === "pay_at_studio"
    ? enteredCode.trim().toUpperCase() || undefined
    : undefined;
}
