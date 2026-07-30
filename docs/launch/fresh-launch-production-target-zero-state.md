# Fresh Launch Production Target Zero-State Specification

This specification is evidence-only and does not authorize target creation.

A future target is acceptable before configuration import only when:

- It is independently identified as the approved fresh target.
- It contains exactly 91 migrations through `0091`.
- Its schema, triggers, foreign keys, indexes, and append-only Finance
  protections match the approved commit.
- Configuration tables contain only documented migration-created defaults.
- Every manifest `exclude` transaction group has aggregate count zero.
- Every decision-required identity/audit group is empty unless an explicit
  approved bootstrap step applies later.
- No package order, credit transaction, booking, attendance, payment record,
  payment event, refund, promotion redemption, notification transaction, or
  Ballet transaction exists.
- No unexplained sequence advance exists.
- No API, Worker, Admin, integration, or human writer is connected.
- The pre-import fingerprint and aggregate evidence are captured without PII.

Any unexpected row, migration, schema difference, sequence state, writer, or
identity record is a hard `NO-GO`. The target must not be repaired implicitly;
it must be rejected or handled under a separately approved procedure.
