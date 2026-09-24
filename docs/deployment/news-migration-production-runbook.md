# News → Editorial migration — production operating sequence

Final Editorial, Phase B. **Nothing in this document has been executed.** It
describes the only authorized way to run the migration against production, so
that on the day of the cutover nobody has to invent one.

## Why there are two commands, not one

`pnpm run news:migrate:*` is the **local** tool. It refuses production in all
five modes (`assertEnvironmentSafe`) and that refusal is permanent — it is a
defence layer, not a default that gets overridden later.

Production operations use two **separate** commands with **disjoint**
authorization:

| | command | modes | authorization flag | confirmation |
|---|---|---|---|---|
| read-only | `pnpm run news:migrate:production:read-only` | `dry-run`, `verify`, `rollback-dry-run` | `--i-authorize-production-read-only-news-migration` | `--confirm "PRODUCTION READ-ONLY NEWS MIGRATION"` |
| write | `pnpm run news:migrate:production:write` | `execute`, `rollback` | `--i-authorize-production-news-migration-write` | `--confirm "<mode phrase>"` **plus** a second phrase typed at an interactive prompt |

The write mode phrases are `PRODUCTION MIGRATE NEWS TO EDITORIAL` and
`PRODUCTION ROLL BACK NEWS MIGRATION`. The flags and phrases are disjoint on
purpose: an authorization to *look* at production can never be spent on a
*write*, and each write mode is authorized separately.

Both commands additionally require, every time:

* `--environment production` (exactly);
* `--manifest <path>` — a manifest that parses under the strict schema;
* `--expected-commit <sha>` — must equal Railway's `RAILWAY_GIT_COMMIT_SHA`;
* `--expected-plan-schema-version <n>`;
* a **positively proven** Railway production context: environment name,
  project ID, service context, and a `.railway.internal` database host. None
  of these can be produced from a laptop, and a generic remote Postgres that
  merely calls itself "production" is refused.

There is **no** `--force`, `--allow-production`, `--skip-safety`, `--yes` or
equivalent, in either command. Those names are rejected by name at the
argument contract.

## The sequence

Run in this order. Do not skip a step, and do not run a later step because an
earlier one "obviously" passed.

1. **Deploy** the Phase B schema and tooling. Railway's normal preDeploy
   migrator applies schema migrations 0129/0130. Nothing about the News
   **data** migration runs automatically on any deploy, startup, worker or
   cron path — it is operator-invoked CLI tooling and only that.
2. **Fill and approve the manifest.** Every author `(name, role)` pair, every
   topic decision, every feature/body/gallery alt text, the featured
   placement, and any slug overrides. The `Victoria Vance` byline appears
   under two different roles and therefore needs two entries (pointed at one
   author id if that is what a person decides). Anything undecided is a
   blocker, and no flag downgrades a blocker.
3. **Authorized production dry-run** (read-only):
   `news:migrate:production:read-only --mode dry-run …`.
   Counts come from the real planner against the real production rows.
   Exit code 4 means the plan still has blockers — return to step 2.
4. **Review the reconciliation.** Read the plan output in full: blocked rows,
   content-review notes, the cross-type preservation manifest (News →
   Performance references, which are deliberately never written as Editorial
   recommendations), and the dropped news→news references.
5. **Obtain owner authorization** for the write, in writing, referencing the
   reviewed dry-run output and the commit SHA it ran against.
6. **Authorized production execute** (write):
   `news:migrate:production:write --mode execute …`. It re-plans against
   production first and prints that plan before prompting; an interrupted run
   is resumed by running it again (one transaction per legacy post,
   idempotent via provenance).
7. **Authorized production verify** (read-only):
   `news:migrate:production:read-only --mode verify …`. Exit code 5 is a
   verification failure and must be investigated before anything else.

## If a rollback is needed

8. **Rollback dry-run first, always** (read-only):
   `news:migrate:production:read-only --mode rollback-dry-run …`. It lists
   exactly which posts would be deleted and which are protected because an
   editor has changed them since the migration.
9. **Rollback only with a separate, explicit authorization** (write):
   `news:migrate:production:write --mode rollback …`. This is a *second*
   owner decision, not a continuation of the step-5 one, and it uses its own
   confirmation phrase.

`website_news_posts` is never modified in any mode, forward or back. A
rollback does not undo `admin_activity_logs` entries, and it never deletes
editorial authors or topics (the migration creates none).
