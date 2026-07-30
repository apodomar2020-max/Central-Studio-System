# Participant Lifecycle Owner Acceptance

This checklist is for the current pre-launch environment. It is not approval
for the Fresh Launch Database cutover or public launch.

## Access

- Admin: `https://central-studio-system-admin.vercel.app`
- API health: `https://supportive-magic-production-b800.up.railway.app/api/healthz`
- Mobile project: `artifacts/central`
- Test credentials: use existing pre-launch test accounts. No credentials are
  stored in this document or repository.

## Expo Go

From the repository root, obtain the existing pre-launch API key through the
approved secure channel, then run:

```sh
cd artifacts/central
EXPO_PUBLIC_API_URL=https://supportive-magic-production-b800.up.railway.app \
EXPO_PUBLIC_API_KEY='<existing pre-launch API key>' \
pnpm exec expo start --go
```

Do not commit the API key or save it in an unignored file.

Expo Go does not support the native Facebook SDK or production push delivery.
Use email authentication for this acceptance pass. Participant Lifecycle
catalogue, package, booking, and attendance-history flows do not depend on
those native capabilities.

## Recording results

For each scenario record:

- Result: `Pass` / `Fail`
- Notes:
- Screenshot reference:
- Approximate time:
- Account label and selected participant:
- Class/schedule and package:
- Expected result:
- Actual result:

Do not include passwords, tokens, full dates of birth, or customer information.

## Recommended order

1. Confirm API health and Admin login.
2. Review class and package age configuration.
3. Test Student self purchase and booking.
4. Test Parent self and child ownership separation.
5. Test booking-backed and walk-in attendance.
6. Review Admin participant metadata.
7. Verify Finance classifications.
8. Open the main Ballet pages for regression review.

## Student

### Catalogue and age eligibility

1. Log in with an eligible synthetic Student account.
2. Browse classes and packages.
3. Open an eligible class and an age-ineligible class.

Expected: eligible catalogue entries are available; ineligible direct details
show the eligibility decision and protected actions remain blocked.

Result / Notes / Screenshot:

### Package, credit, booking, and attendance

1. Purchase a package for self.
2. Have the package order activated through the normal Admin flow.
3. Confirm credits appear for self.
4. Book an eligible occurrence using one credit.
5. Confirm exactly one credit was deducted.
6. Check in through the supported booked-attendance flow.
7. Confirm no second credit was deducted.
8. Review attendance history.

Expected: payer and participant are the Student; one booking deduction exists;
attendance creates no second deduction.

Result / Notes / Screenshot:

## Parent

### Participant separation

1. Log in with a synthetic Parent account.
2. Select Parent self and each owned child.
3. Purchase one package for Parent self and one for Child A.
4. Activate both through the normal Admin flow.
5. Confirm balances remain separated.
6. Attempt to use Child A's package for Parent self and Child B.

Expected: valid owners can use their package; cross-participant use is rejected.

Result / Notes / Screenshot:

### Child eligibility and booking

1. Select the eligible child.
2. Book an eligible occurrence with that child's package.
3. Select the ineligible child and attempt the same class.
4. Check in the booked eligible child.
5. Review the Parent's attendance history.

Expected: the selected participant controls age and package eligibility;
history distinguishes Parent self and each child.

Result / Notes / Screenshot:

### Child package-purchase DOB hotfix retest

1. Reload Expo Go; clear the development cache only if the previous bundle is
   still displayed.
2. Log in with the same synthetic Parent test account.
3. Open the same Kids package and select the same owned child.
4. Confirm that the displayed age and eligibility match the child's current
   profile, then submit the purchase.
5. Open Admin Package Orders and confirm the Parent is the payer while the
   selected child is the participant.
6. Confirm no duplicate order exists from earlier failed attempts.

Expected: a child with canonical DOB submits successfully. A child without
canonical DOB shows no age, is not marked eligible, and cannot submit until the
profile is updated.

Result / Notes / Screenshot:

## Restrictions

Test each case independently:

- Expired package
- Wrong dance type
- No remaining credits
- Missing or invalid DOB when safely represented
- Capacity-full occurrence
- Duplicate booking
- Package owned by a different participant

Expected: the server rejects the protected action with a stable explanation and
does not deduct a credit or create a partial booking.

Result / Notes / Screenshot:

## Attendance and walk-ins

Test:

- QR booked check-in
- Duplicate QR scan
- Manual booked check-in
- Package-credit walk-in
- Paid Pay-at-Studio walk-in
- Unpaid walk-in cancellation

Expected:

- Booking-backed attendance never deducts a second credit.
- Package walk-in deducts exactly one credit and creates no cash revenue.
- Paid walk-in creates canonical booking, attendance, and payment data.
- Unpaid walk-in creates no records.

Result / Notes / Screenshot:

## Admin

Open Package Orders, Bookings, Attendance, Walk-ins, and Finance. Confirm:

- Payer and participant are distinguishable.
- Participant snapshot and self/child label are visible.
- Package, booking, attendance, and payment source metadata are visible.
- Participant reassignment is not offered.

Result / Notes / Screenshot:

## Finance

Confirm:

- Package purchase uses the existing package-revenue classification.
- Package booking creates no additional cash revenue.
- Booking-backed attendance creates no additional revenue.
- Package walk-in creates no cash revenue.
- Paid walk-in creates the existing canonical payment record.
- Unpaid walk-in creates zero writes.

Result / Notes / Screenshot:

## Ballet regression

Open the Ballet catalogue and core Admin Ballet pages used in the current
pre-launch workflow.

Expected: Ballet remains separate from General Studio participant packages,
credits, attendance, and Finance classification.

Result / Notes / Screenshot:

## Reporting a defect

Include the screenshot reference, approximate time, test account label,
selected participant, class/schedule, package state, expected result, and actual
result. Never include credentials, tokens, or customer PII.

## H3 participant-integrity retest

Run in this order after the H3 deployment. Record `Pass`, `Fail`, `Notes`, and
`Screenshot reference` for every row; never include credentials.

| # | Retest | Pass/Fail | Notes | Screenshot reference |
|---|---|---|---|---|
| 1 | Adults-only class participant selector |  |  |  |
| 2 | Kids-only class participant selector |  |  |  |
| 3 | Parent self versus each child |  |  |  |
| 4 | Package-credit booking for an eligible child |  |  |  |
| 5 | QR scan for that exact child booking |  |  |  |
| 6 | Only the booked child appears |  |  |  |
| 7 | No package/payment reselection appears |  |  |  |
| 8 | No second credit deduction occurs |  |  |  |
| 9 | Existing Pay-at-Studio booking |  |  |  |
| 10 | Select Cash or Card |  |  |  |
| 11 | Finance shows the selected method |  |  |  |
| 12 | Genuine Package Walk-in |  |  |  |
| 13 | Genuine Pay-at-Studio Walk-in |  |  |  |
| 14 | Unpaid Walk-in creates no records |  |  |  |
| 15 | Finance distinguishes payer and participant |  |  |  |
| 16 | Historical unavailable schedule card |  |  |  |
