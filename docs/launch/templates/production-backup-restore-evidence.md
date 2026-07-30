# Production Backup and Restore Evidence Template

Store restricted identifiers in the approved change system, not Git.

| Evidence | Required value |
|---|---|
| Backup method |  |
| Backup scope |  |
| Encryption confirmed |  |
| Completion time |  |
| Verification method and result |  |
| Restore rehearsal environment classification |  |
| Restore start/end time |  |
| Restore result |  |
| Migration count/latest migration after restore |  |
| Readiness result after restore |  |
| Finance aggregate reconciliation |  |
| Ballet aggregate reconciliation |  |
| Owner role | `database_operator` |
| Reviewer role |  |
| RTO result |  |
| RPO result |  |
| Retention policy |  |
| Evidence expiry |  |
| Approval reference |  |

The completed evidence must be approved by `database_operator`,
`engineering_owner`, and `finance_owner`. No cutover is permitted after evidence
expiry or a failed restore/reconciliation.
