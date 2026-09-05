export const BOOKING_CARD_REFERENCE_WIDTH = 356;
export const BOOKING_CARD_MAX_WIDTH = 420;
export const BOOKING_CARD_MAX_HEIGHT = 300;
export const BOOKING_CARD_MIN_HEIGHT = 258;
export const BOOKING_CARD_ASPECT_RATIO = 1.36;

/**
 * Keeps the visual proportions of the approved My Bookings reference while
 * preserving enough vertical room for labels on narrow Android devices.
 * Wider surfaces are capped because the application is designed for phones;
 * this also prevents an Android tablet or foldable from stretching the card.
 */
export function bookingCardHeightForWidth(width: number): number {
  const usableWidth = Number.isFinite(width) && width > 0
    ? Math.min(width, BOOKING_CARD_MAX_WIDTH)
    : BOOKING_CARD_REFERENCE_WIDTH;

  return Math.round(Math.min(
    BOOKING_CARD_MAX_HEIGHT,
    Math.max(BOOKING_CARD_MIN_HEIGHT, usableWidth / BOOKING_CARD_ASPECT_RATIO),
  ));
}
