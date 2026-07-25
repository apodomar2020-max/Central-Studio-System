-- Pre-Phase-2 Payment Integrity Hotfix — duplicate-activation diagnostic.
--
-- READ-ONLY. Not executed as part of this change and not run against
-- production by this task. Provided for whoever owns production access to
-- run manually (e.g. via a read replica or a one-off read-only session)
-- to size how many historical orders were affected by the duplicate
-- package_activated credit-issuance defect this hotfix closes
-- (packageOrders.ts's activation transaction previously had no row lock and
-- no guard against being re-entered for an already-active order).
--
-- A non-empty result does not itself corrupt anything further — it only
-- identifies package_orders whose remainingCredits/totalCredits may be
-- overstated relative to what was actually purchased, because more than one
-- package_activated ledger row exists for that order. Any remediation
-- (crediting back, contacting affected students, adjusting balances) is an
-- operational decision outside the scope of this hotfix and must go through
-- the existing credit-adjustment endpoint
-- (POST /admin/package-orders/:id/credits), never a direct data patch.

SELECT
  package_order_id,
  count(*) AS activation_count,
  sum(delta) AS total_credits_issued_via_activation,
  array_agg(id ORDER BY id) AS credit_transaction_ids,
  array_agg(created_at ORDER BY id) AS activation_timestamps
FROM credit_transactions
WHERE type = 'package_activated'
GROUP BY package_order_id
HAVING count(*) > 1
ORDER BY count(*) DESC, package_order_id;
