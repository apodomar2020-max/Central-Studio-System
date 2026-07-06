/**
 * Spreadsheet formula-injection sanitizer (Security Phase H).
 *
 * POLICY: every text cell written to ANY spreadsheet export — current XLSX
 * reports and any future CSV/XLSX export — MUST pass through
 * sanitizeCellText(). Excel/LibreOffice interpret cell text beginning with
 * `=`, `+`, `-`, `@`, tab, or carriage return as a formula in CSV files and
 * when values are copy/pasted or re-saved as CSV, letting attacker-supplied
 * data (student names, emails, feedback…) execute as formulas on an admin's
 * machine (e.g. `=HYPERLINK(...)`, `=cmd|' /C calc'!A1`).
 *
 * Mitigation: prefix dangerous values with an apostrophe (`'`) — the
 * spreadsheet-standard "treat as literal text" marker, which Excel does not
 * display.
 *
 * Exemption: values that are entirely number/phone-like (optional +/- sign
 * followed by digits, spaces, dots, dashes, parentheses) are left untouched.
 * Exported phone numbers such as `+20 10 0000 0000` are legitimate and
 * common; a purely numeric +/- string cannot form a formula call, so the
 * exemption is safe and keeps phone/number columns usable.
 */

const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;
const NUMBER_OR_PHONE_LIKE = /^[+\-]?[\d\s().-]+$/;

export function sanitizeCellText(value: string): string {
  if (!DANGEROUS_PREFIX.test(value)) return value;
  if (NUMBER_OR_PHONE_LIKE.test(value)) return value;
  return `'${value}`;
}
