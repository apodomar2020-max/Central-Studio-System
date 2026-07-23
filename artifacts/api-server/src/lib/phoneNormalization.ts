/**
 * Egypt-aware phone normalization — the canonical implementation, shared by
 * any module that needs to match phone numbers across input formats
 * (local "01xxxxxxxxx", "+20xxxxxxxxxx", "0020xxxxxxxxxx").
 *
 * Originally lived only in routes/marketing.ts; moved here so a neutral
 * shared utility owns it instead of Attendance depending on Marketing.
 * Behavior is unchanged byte-for-byte from the original.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("01") && digits.length === 11) digits = `20${digits.slice(1)}`;
  if (digits.startsWith("1") && digits.length === 10) digits = `20${digits}`;

  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}
