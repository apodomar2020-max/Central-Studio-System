# Fresh Launch Maintenance Window Plan

## Window

- Window date: `[PENDING]`
- Start/end time: `[PENDING]`
- Maximum duration: `[PENDING]`
- Writer-freeze time: `[PENDING]`
- Pre-write rollback deadline: `[PENDING]`
- Observation window: `[PENDING]`

## Service behavior

- Queue policy: pause consumers and preserve queued/in-flight evidence.
- API status: public reads may remain only if explicitly approved; all writes blocked.
- Admin: write actions blocked.
- Worker: paused until target validation and open-writers approval.
- User communications: owner, channels, timing, and status wording `[PENDING]`.

## Go/No-Go checkpoints

1. Named approval and staffing checkpoint.
2. Backup and restore-evidence checkpoint.
3. Writer-freeze verification.
4. Source capture/export checkpoint.
5. Target import/equivalence checkpoint.
6. Smoke, Finance, Ballet, monitoring checkpoint.
7. Pre-write rollback deadline.
8. Named open-writers approval.
9. First controlled transaction reconciliation.
10. Observation-window handoff.

## Abort conditions

Abort for missing/expired approval, uncertain environment identity, active
writers, failed backup/restore evidence, source mutation, timeout, import or
equivalence failure, nonzero transferred transactions, smoke failure,
connection inconsistency, Finance/Ballet mismatch, monitoring failure, or
unassigned incident ownership.

Escalation contacts are represented only by the roles in the named-approver
matrix. Do not place personal contact details in this file.
