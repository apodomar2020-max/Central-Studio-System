# Fresh Launch Approval Summary for Owners

The participant, age eligibility, package, booking, attendance, Finance, and
Ballet launch architecture is technically complete and has passed local
failure and lifecycle rehearsals.

## Why use a fresh database?

The current database contains disposable pre-launch transactions intertwined
with intentionally protected Finance records. Deleting that graph would require
weakening safeguards. Instead, the current database will be preserved under an
approved archive policy and a fresh database will start with approved
configuration only.

## What transfers?

Only reviewed launch configuration: Studio classes, schedules, packages,
canonical dance restrictions, pricing/settings, public content, promotions,
and approved Ballet configuration. Public media and contact settings transfer
only if owners explicitly approve their classification.

## What does not transfer?

Accounts and credentials, children, package orders, credits, bookings,
attendance, payments, payment events/refunds, promotion use, notification
devices/history, Ballet transactions, audit logs, backfill progress, generated
reports, and customer uploads are excluded unless a specific decision says
otherwise. Passwords, sessions, tokens, and OAuth credentials never transfer.

## What owners are approving

Owners must decide identity recreation, Ballet contacts, archive retention,
logs, media, backup/restore, maintenance timing, post-write incidents,
notifications, Finance history, and sequence handling. Each approval is
role-specific, time-limited, evidence-backed, and tied to the exact code and
manifest. A recommendation is not approval.

## Why backup and restore are mandatory

A backup is useful only if it can be restored and reconciled. Before any
inspection or maintenance, the database operator, Engineering, Finance, and
Security must approve evidence that the source can be restored within the
agreed recovery objectives and that Finance and Ballet aggregates reconcile.

## What happens during maintenance?

Writers and queues are frozen, the source is captured read-only, the fresh
target is migrated and verified empty, approved configuration is imported, and
Studio, Finance, and Ballet smoke checks run. Writers open only after a named
approval and a controlled first transaction.

Before the first target write, a carefully verified return to the source may be
possible. After the first target write, the old database cannot simply become
writable again: all writers stop and both databases must be reconciled to avoid
duplicate or lost financial and operational records.

## What G2B approval means

G2B approval permits only a time-limited, aggregate-only, read-only inspection
of the exact approved production source. It does not permit target creation,
configuration transfer, writer shutdown, connection switching, cutover,
deployment, or launch.

Current status: **G2B NOT AUTHORIZED; human decisions and evidence pending**.
