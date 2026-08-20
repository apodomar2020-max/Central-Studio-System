-- Migration 0112: Wave 3 — correct the stale in-app cancellation policy copy
--
-- WHY: The Cancellation & Refund Policy investigation (Wave 2) found the
-- app's "Help & Support" content page (app_content_pages, slug
-- 'help-support') telling customers:
--   "How do I cancel a booking? You can cancel a booking up to 24 hours
--    before the class starts. Contact us via WhatsApp for cancellations."
-- This directly contradicted the actual system: there was no time-window
-- enforcement at all (F-20), and no self-service cancellation existed —
-- customers could only cancel via a WhatsApp request to staff.
--
-- Wave 3 implements the owner-approved policy: a real, server-enforced
-- 2-hour self-cancellation cutoff, with a genuine in-app Cancel action
-- (PATCH /bookings/:id/cancel). This migration corrects the copy to match
-- that now-real behavior — WhatsApp is no longer the only path.
--
-- SAFETY: content-only UPDATE, no schema change. Scoped to the EXACT
-- original stale sentence via the WHERE clause below, so this is a no-op
-- (and does not clobber a real admin edit) if the content has already
-- diverged from the original 0014 seed text — matching this repo's
-- existing content-seed migration convention (see 0014_app_content_pages).
-- The "Can I cancel a pending package request?" Q&A already accurately
-- described the pendingPayment self-cancel affordance and is untouched.
-- No Ballet-specific text lives on this page — Ballet's own
-- cancellation/refund policy is handled entirely within its own screens
-- and is not touched by this migration.

UPDATE app_content_pages
SET
  content = replace(
    content,
    'How do I cancel a booking?
You can cancel a booking up to 24 hours before the class starts. Contact us via WhatsApp for cancellations.',
    'How do I cancel a booking?
You can cancel a class booking yourself in the app, in the Bookings tab, up to 2 hours before the class starts. If a paid booking is cancelled in time, a refund is reviewed and processed by our team. Within 2 hours of class start, contact us via WhatsApp.'
  ),
  updated_at = now()
WHERE slug = 'help-support'
  AND content LIKE '%How do I cancel a booking?
You can cancel a booking up to 24 hours before the class starts. Contact us via WhatsApp for cancellations.%';
