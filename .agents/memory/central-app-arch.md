---
name: Central mobile app architecture
description: Post-Stage-removal architecture, context API shape, and component gotchas for the Central Studio Expo app
---

# Central Studio mobile app — post-overhaul architecture

## What changed
Central Stage was fully removed. The app is now Studio-only.

## Tab navigation (5 tabs)
Home · Classes · Booking · Packages · Profile

`app/(tabs)/offers.tsx` was the old Offers tab — it was deleted. If it reappears, Expo Router will auto-detect it and add a 6th tab. Always delete orphaned tab files.

## AppContext shape (no Stage)
Removed: `mode`, `setMode`, `referralCount`, `proProfile`, `walletBalance`, `stageApplications`
Added: `packages`, `userPackages`, `balletApplications`, `children`, `notifications`, `referralCredits`, `referralCode`

`referralCount` is not in context — hard-code to 0 or derive locally if needed.

## User.role type
`"student" | "parent" | "instructor"` — "professional" was removed with Stage. Register screen must not include that option.

## User object requires `emailVerified: boolean`
Mock users in auth screens must set this field.

## Key component gotchas
- `StepIndicator` props: `{ current, total, labels?, mode? }` — NOT `steps`/`currentStep`/`color`
- `NewStudentBanner` has built-in `marginHorizontal: 20` — don't wrap with extra padding
- `AppButton` variant `"stage"` still exists in the component but should not be used (no Stage mode)

## Data layer
`mockData.ts` exports: `DANCE_CLASSES`, `DANCE_CATEGORIES`, `PACKAGES`, `BALLET_ASSESSMENT_SLOTS`, `BALLET_LEVELS`, `BALLET_PRICING`, `NOTIFICATIONS`, `getCurrentWeekClasses()`, `getInstructor()`, `getClassById()`, `getFeaturedClasses()`, `BALLET_CATEGORY`

AgeGroup type: `"Kids" | "Teens" | "Adults"` — no "Seniors" or "All"
Ballet category has `isBallet: true` and is filtered out of normal class lists.

**Why:** Stage was a professional dancer marketplace bolt-on. It was removed per product decision to focus on the dance school (Studio) use case only.

## Typecheck noise vs real crashes
`pnpm exec tsc -p tsconfig.json --noEmit` on central reports a stable set of pre-existing type-only errors that do NOT crash at runtime and should be left alone: `AppButton` has no `style` prop, `/(tabs)/` route literal typing, `OfferCard` importing `Offer` (type-only), and a `useColors` radius cast. Real crashes (caught by ErrorBoundary as "Invalid hook call") come from stale references to removed context members or non-existent `mockData` exports — those surface as actual undefined-deref errors, not just type mismatches. When health-checking, distinguish these: fix stale-reference crashes, ignore the known type-only set.

**Booking object contract:** `Booking` requires `bookingType` ("single"|"package"|"ballet") and `attendanceStatus` ("booked"|"attended"|"noShow"|"cancelled"). `ChildProfile` uses `fullName` (not `childName` — that belongs to `BalletApplication`).
