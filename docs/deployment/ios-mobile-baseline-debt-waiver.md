# Mobile baseline debt — owner release waiver, 2026-10-04

Production base: `e04203aed8d841c8e42c9ad54c2f530c570b3f5b`.

The owner accepts only the exact 28 failures below as pre-existing iOS 1.0 baseline debt. They are NOT fixed. Production main: 468 tests, 440 pass, 28 fail, zero skipped. Candidate: 480 tests, 452 pass, the identical 28 failures, zero skipped. Zero new or changed failures are permitted; any additional or changed failure blocks release. No failing mobile test was changed, skipped, removed, or weakened to obtain this state.

The canonical full suite (`sh test-mobile.sh`) was executed independently in production-main and candidate worktrees. Exact ordered failure-name comparison passed. Targeted accepted iOS/backend/editorial suites passed separately. Full comparison evidence is also retained locally at `/private/tmp/central-ios-candidate-evidence/mobile-comparison.json`.

## Exact unchanged failures (separate technical debt)

1. application submission and landing focus both trigger an authoritative applications refresh
2. the real student card uses one unified two-column premium surface
3. metadata rows are not wrapped in a nested dark details card
4. the left panel uses the exact static local ballerina asset
5. the outer card is the only clipping surface and artwork is flush to its edges
6. the details panel keeps padding independent from the flush artwork
7. the artwork content row extends directly to the full-width footer divider
8. metadata rows keep icon, label, and value in one horizontal row
9. metadata values align to the far right
10. one active student plus an eligible child appends the CTA card
11. only the Add Another Child card is clickable
12. the coming-soon footer remains centered below a divider
13. long names and narrow Samsung-width cards use shrink-safe responsive layout
14. the real card no longer uses the previous oversized fixed or minimum height
15. pending and active cards share a common content-region minimum height sized for the Active layout
16. existing Apply Now placement and Ballet navigation cards remain unchanged
17. My Ballet Classes child pills match the My Bookings filter source values
18. Ballet selector remains single-child only with Bookings press behavior
19. child-specific cancellation and lifecycle safeguards remain present
20. BookingCard treats an unknown bookingStatus as past, not upcoming
21. bookingStatusConfig gives 'unknown' its own neutral label, distinct from Confirmed
22. boundary: Ballet's own unrelated assessment fee copy is untouched (not F-17-specific)
23. each child in the picker is independently disabled and labeled — an unrelated sibling remains selectable
24. historical bookings with missing class or schedule relations are visibly unavailable and non-actionable
25. artifacts/central/app/class/[id].tsx: the detail badge reads the class's own stored level
26. diffColor is unchanged — this correction only changes the INPUT to the color mapping, not the mapping itself
27. artifacts/central/app/(tabs)/index.tsx: purchasePackage() explicitly sends paymentMode: "pay_at_studio"
28. both entry points send the exact same paymentMode value

This waiver authorizes local release-candidate preparation only, not production deployment, secret/grant changes, EAS builds, or submission.
