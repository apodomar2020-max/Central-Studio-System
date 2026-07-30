# Fresh Launch Phase G2 Entry Gates

| Gate | Current status | Evidence | Required approver | Blocking |
|---|---|---|---|---|
| Technical rehearsal | Satisfied | G1R reports and commit `c8da476` | engineering_owner | Yes |
| Failure rehearsal | Satisfied | G1R closure report and commit `07b9369` | engineering_owner | Yes |
| Source immutability | Satisfied | Fingerprint and read-only tests | engineering_owner, security_or_data_owner | Yes |
| Finance isolation | Satisfied | Finance regression and transaction exclusion | finance_owner | Yes |
| Ballet isolation | Satisfied | Ballet regression and transaction exclusion | ballet_domain_owner | Yes |
| Approval bundle tooling | Technically prepared; approvals pending | G2A schema/tests | All seven roles | Yes |
| Backup policy | Pending | Backup/restore template only | database_operator, finance_owner | Yes |
| Restore rehearsal | Pending | No completed evidence | database_operator, engineering_owner | Yes |
| Identity policy | Pending | ID-01 and ID-02 | business_owner, security_or_data_owner | Yes |
| Archive policy | Pending | ID-04 and ID-05 | finance_owner, security_or_data_owner | Yes |
| Maintenance window | Pending | Window template only | business_owner, engineering_owner, release_operator | Yes |
| Named approvers | Pending | Role matrix; assignments blank | business_owner | Yes |
| Sequence policy | Pending | ID-12 | engineering_owner, database_operator | Yes |
| Post-write policy | Pending | ID-09 and runbook; no human approval | engineering_owner, finance_owner | Yes |
| Production inspection | Not executed | Future Phase G2B | engineering_owner, security_or_data_owner | Yes |

No pending gate becomes satisfied through code or template creation.
