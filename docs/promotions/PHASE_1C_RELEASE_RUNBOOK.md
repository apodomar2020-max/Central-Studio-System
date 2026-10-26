# Promotions release runbook

The current consolidated procedure and single approval scope are in [PROMOTIONS FINAL RELEASE READINESS](PROMOTIONS_FINAL_RELEASE_READINESS.md).

The Owner confirms Production contains test data only and that the authorized inventory completed. Prior customer-distribution and inventory-access blockers are closed. The completed Phase 1C/inventory reports remain historical verification evidence; their earlier unexecuted-inventory statements are superseded by the Owner's confirmed result.

The Owner has approved the consolidated final scope, including controlled commit/push/merge and Production execution. No additional general release approval is required; execution gates remain mandatory. Follow the consolidated report's migration-before-API ordering, guarded exact test cleanup or audited deactivation, complete writer drain, Admin/Mobile coordination, optional enforcement, bounded smoke tests and history-preserving rollback. Do not repeat the inventory or enable broad legacy rejection.
