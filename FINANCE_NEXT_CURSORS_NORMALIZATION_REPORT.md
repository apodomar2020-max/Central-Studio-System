# Finance Next Cursors Normalization Report

## Starting production commit

`c5ed0d284fb16b5127e5a4e42dc84b56fe8ede8f`

## Previous pagination contracts

The investigation found two separate mechanisms:

- `GET /api/finance/transactions` and all six Admin Finance transaction views use bounded page-number pagination (`page`, `limit`, `totalPages`). They do not return or consume `nextCursor` or `nextCursors`.
- The internal Finance historical backfill dry-run is the only Finance workflow returning `nextCursors`. It returned a partial map of raw numeric source IDs plus a global `truncated` flag.

Finance Overview is not paginated. Finance exports perform one capped, ordered read rather than client pagination. Backfill batch listing is a fixed, newest-first list capped at 100 and exposes no continuation contract.

## Root cause of inconsistency

The dry-run report overloaded three representations:

- a missing source key could mean unrequested, unvisited, or exhausted;
- a numeric value was the last scanned row, not necessarily proof that another row existed;
- `truncated` was global and could disagree with the per-source map.

The raw numeric IDs were also implementation boundaries rather than opaque client cursors.

## Final canonical contract

The multi-source backfill report now returns:

```json
{
  "pageInfo": {
    "hasNextPage": true,
    "nextCursors": {
      "package_orders": null,
      "bookings": "<opaque cursor>",
      "studio_walkins": null
    }
  }
}
```

Every source key is always present. Exhausted or out-of-scope sources are `null`. Empty strings and missing keys are never emitted. `hasNextPage` is derived from whether at least one source cursor is non-null, so contradictory states cannot be produced.

## Single-source behavior

No Finance endpoint currently uses a single cursor. The Finance transaction endpoint retains its existing deterministic page-number contract; replacing it with cursors would be a larger unrelated API change and would unnecessarily break the deployed Admin.

## Multi-source behavior

Each backfill source advances independently. The planner reads one extra row per visited source before issuing a continuation cursor. If the shared row budget is exhausted before a later source is visited, it performs a bounded one-row existence probe and preserves that source's current boundary only when data remains. One exhausted source therefore cannot erase another source's continuation.

## Cursor encoding and validation

Canonical cursors are deterministic base64url encodings of a versioned, source-bound boundary. Clients treat them as opaque. Decoding:

- trims surrounding whitespace;
- rejects empty or values longer than 256 characters;
- rejects malformed JSON/base64url and unsupported versions;
- validates the source family and a non-negative safe-integer boundary;
- rejects a cursor presented for another source;
- rejects non-canonical encodings.

Malformed CLI cursors return the existing validation error path rather than reaching the database or producing an unhandled error.

## Backward compatibility

For one transition release, reports retain:

- `truncated`, synchronized exactly with `pageInfo.hasNextPage`;
- the legacy numeric `nextCursors`, now with every source key explicitly present.

Both are marked deprecated. Existing `--cursor family:id` CLI input remains accepted, while new opaque values from `pageInfo.nextCursors` are also accepted. The canonical output and operator guidance use `pageInfo`.

## Admin state handling

No Admin code changed because no Admin Finance page consumes `nextCursors`. The shared transaction view already:

- uses one deterministic total order (`occurredAt`, then stable synthetic event ID);
- prevents a filter change from retaining an invalid page;
- keeps each page in the query cache;
- disables pagination controls while loading;
- preserves the current rendered result on a failed new request through React Query.

Introducing a cursor map into these pages would not match their actual API architecture.

## Endpoints changed

No HTTP Finance endpoint contract changed. The affected report path is the internal zero-write Finance historical backfill dry-run consumed by the dry-run CLIs and evidence workflow.

## Endpoint inventory

- Finance Overview: not paginated.
- Finance Transactions, Packages, Class & Walk-in, Ballet, Refunds, Discounts: one shared `/api/finance/transactions` page-number contract.
- Finance export: capped one-shot query, no cursor.
- Backfill batch list: fixed latest 100, no continuation.
- Backfill dry-run/evidence: multi-source cursor map normalized by this change.

## Tests

Focused coverage includes opaque round trips, stable encoding, invalid/oversized/source-mismatched cursors, complete source maps, explicit exhaustion, no empty strings, legacy/canonical agreement, CLI legacy compatibility, canonical CLI decoding, dry-run continuation, bounded mixed-source scanning, deterministic ordering, and evidence compatibility.

## Typecheck and build results

- Locked dependency installation: passed.
- Libraries typecheck: passed.
- API typecheck: 121 existing repository-wide errors, identical to the starting baseline; zero errors in changed files and zero new errors.
- API/Worker production build: passed.
- Admin typecheck: passed.
- Admin production build: passed.
- Native browser alert scan: passed across 134 Central files.
- Affected Finance, backfill, pagination, UI, permission, export, Booking, and Package regression assertions: 343 passed, zero failed, zero skipped. The two legacy module-mock suites require Node's `--experimental-test-module-mocks` flag and passed when invoked through their supported runner mode.

## Manual UAT checklist

- Run a one-source dry-run through multiple pages and confirm no duplicate or missing counts.
- Run all three sources with a small shared limit and confirm a later source cursor is preserved.
- Confirm every source key is present and exhausted sources are `null`.
- Confirm `hasNextPage` becomes false on the final page.
- Confirm a malformed or source-mismatched cursor is rejected.
- Confirm existing numeric CLI cursors still work during the transition.
- Confirm Admin Finance transaction paging, filters, refresh, empty results, and failed-page behavior remain unchanged.

These checks remain pending for the owner unless explicitly recorded otherwise.

## Deployment plan

Merge the verified feature into the latest `origin/main`, re-run affected checks in a clean release worktree, push through the repository's normal process, and monitor Railway API, Railway Worker, and Vercel Admin. Central mobile is excluded.

## Rollback plan

Revert the release merge. Because there is no migration or persisted cursor format change, rollback restores the former report shape without data repair.

## Remaining limitations

The Admin Finance transaction feed remains intentionally page-number based and bounded to 200 pages. The backfill report's deprecated numeric cursor fields should be removed only in a separately announced compatibility release after operator tooling has migrated to `pageInfo`.
