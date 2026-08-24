/**
 * Source-inspection coverage for Phase B3B2F — Admin Level-B Manual
 * Resolution UI on the Student Detail page. Same style as
 * studentDeletionImpact.test.ts / studentAttributionPlanner.test.ts (this app
 * has no React component-rendering harness, so coverage confirms the expected
 * code patterns are present in the real source and in the generated contract).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const detailSource = readFileSync(
  resolve(process.cwd(), "artifacts/admin/src/pages/student-detail.tsx"),
  "utf8",
);
const openapiSource = readFileSync(
  resolve(process.cwd(), "lib/api-spec/openapi.yaml"),
  "utf8",
);
const generatedClient = readFileSync(
  resolve(process.cwd(), "lib/api-client-react/src/generated/api.ts"),
  "utf8",
);

function section(): string {
  const match = detailSource.match(
    /function ManualResolutionSection\(\{[\s\S]*?\n\}\n/,
  );
  assert.ok(match, "expected to find the ManualResolutionSection component");
  return match![0];
}

// ─── 1-2: candidate display and empty state ─────────────────────────────────

test("1: each Level-B candidate is rendered from the live contract's levelBResolutions", () => {
  const s = section();
  assert.match(s, /plan\.levelBResolutions/);
  assert.match(s, /entries\.map\(\(entry\) =>/);
  // Safe metadata only: domain label, internal record id, evidence level,
  // resolution status, blocking status.
  assert.match(s, /LEVEL_B_DOMAIN_LABEL\[entry\.domain\]/);
  assert.match(s, /#\{entry\.targetRecordId\}/);
  assert.match(s, /Evidence Level B/);
  assert.match(s, /LEVEL_B_STATUS_LABEL\[entry\.resolutionStatus\]/);
  assert.match(s, /Currently blocks permanent deletion\./);
});

test("2: a no-candidates state is rendered instead of an empty list", () => {
  assert.match(
    section(),
    /entries\.length === 0 \?[\s\S]*?No records currently require manual resolution for this Student\./,
  );
});

// ─── 3-5: the three decisions, each behind an explicit confirmation ─────────

test("3-5: exactly PROVEN_OWNER / NOT_THIS_STUDENT / UNRESOLVED are offered, with human labels", () => {
  const s = section();
  assert.match(
    s,
    /\(\["PROVEN_OWNER", "NOT_THIS_STUDENT", "UNRESOLVED"\] as LevelBDecision\[\]\)\.map/,
  );
  assert.match(detailSource, /PROVEN_OWNER: "Confirm Ownership"/);
  assert.match(detailSource, /NOT_THIS_STUDENT: "Not This Student"/);
  assert.match(detailSource, /UNRESOLVED: "Keep Unresolved"/);
  // Raw enum names are never used as primary UX copy on the buttons.
  assert.match(s, /\{LEVEL_B_DECISION_LABEL\[decision\]\}/);
  assert.doesNotMatch(s, />\s*\{decision\}\s*</);
});

test("3-5: every decision routes through a confirmation dialog before mutating", () => {
  const s = section();
  // The button only stages a pending decision; it never mutates directly.
  assert.match(s, /onClick=\{\(\) => \{ setSuccess\(null\); setError\(null\); setPending\(\{ entry, decision \}\); \}\}/);
  assert.match(s, /<AlertDialog open=\{pending !== null\}/);
  assert.match(s, /mutation\.mutate\(\{/);
  // The mutate call lives inside the AlertDialogAction, not the row button.
  const dialog = s.slice(s.indexOf("<AlertDialog open={pending !== null}"));
  assert.match(dialog, /mutation\.mutate\(\{/);
});

test("3: the PROVEN_OWNER confirmation states that no record ownership is changed", () => {
  assert.match(
    detailSource,
    /This records an ownership decision only\. It does not yet change the historical record ownership\./,
  );
});

test("4: the NOT_THIS_STUDENT confirmation is explicit and non-destructive in copy", () => {
  assert.match(
    detailSource,
    /NOT_THIS_STUDENT: \{[\s\S]*?It does not change or remove the[\s\S]*?record, and it does not change the historical record ownership\./,
  );
});

test("5: the UNRESOLVED confirmation states the record keeps blocking deletion", () => {
  assert.match(
    detailSource,
    /UNRESOLVED: \{[\s\S]*?The record continues to block permanent deletion,/,
  );
});

// ─── 6: EVIDENCE_CONFLICT ───────────────────────────────────────────────────

test("6: an evidence conflict is surfaced, explained, and offers no resolution action", () => {
  const s = section();
  assert.match(s, /conflictCount > 0 && \(/);
  assert.match(s, /Evidence Conflict/);
  assert.match(s, /system evidence signals that disagree/);
  assert.match(s, /permanent deletion\s*\n?\s*remains blocked/);
  // Conflicted candidates are never listed as actionable rows: the live
  // contract deliberately omits them from levelBResolutions, and the
  // conflict block itself renders no decision buttons.
  const conflictBlock = s.slice(s.indexOf("{conflictCount > 0 && ("));
  const conflictEnd = conflictBlock.indexOf("{error && (");
  assert.doesNotMatch(conflictBlock.slice(0, conflictEnd), /mutation\.mutate|setPending/);
});

test("6: no automatic precedence between the disagreeing signals is implied anywhere", () => {
  assert.doesNotMatch(detailSource, /takes precedence|overrides the|wins over|higher priority signal/i);
});

// ─── 7-9: RBAC ──────────────────────────────────────────────────────────────

test("7-9: decision actions require users.delete — users.view/users.edit get read-only", () => {
  assert.match(
    detailSource,
    /canResolve=\{can\("users", "delete"\) && preparationActive && d\.user\.accountStatus === "deactivated"\}/,
  );
  const s = section();
  assert.match(s, /\{canResolve && \(/);
  assert.match(s, /You have read-only access to this review\./);
  assert.doesNotMatch(detailSource, /canResolve=\{can\("users", "edit"\)/);
  assert.doesNotMatch(detailSource, /canResolve=\{can\("users", "view"\)/);
});

test("9: the UI gate is documented as UX only — the route stays the security boundary", () => {
  assert.match(
    detailSource,
    /UX gate only — the route itself enforces users\.delete/,
  );
});

test("9: Super Admin bypass is inherited from AdminAuthContext.can(), not re-implemented", () => {
  const authSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/contexts/AdminAuthContext.tsx"),
    "utf8",
  );
  assert.match(authSource, /if \(user\.isSuperAdmin\) return true;/);
  assert.doesNotMatch(section(), /isSuperAdmin/);
});

// ─── 3 (entry conditions) ───────────────────────────────────────────────────

test("entry conditions: deactivated + active preparation are both required to act", () => {
  assert.match(detailSource, /preparationActive && d\.user\.accountStatus === "deactivated"/);
});

// ─── 10, 12: refetch on success AND on error ────────────────────────────────

test("10: a successful decision refetches the planner and the deletion impact", () => {
  const s = section();
  assert.match(s, /onSuccess: \(\) => \{[\s\S]*?onResolved\(\);/);
  assert.match(
    detailSource,
    /onResolved=\{\(\) => \{[\s\S]*?attributionPlanQuery\.refetch\(\);[\s\S]*?impactQuery\.refetch\(\);[\s\S]*?prepStatusQuery\.refetch\(\);/,
  );
});

test("12: a stale/409 rejection also refetches rather than leaving corrupted UI state", () => {
  const s = section();
  assert.match(s, /onError: \(err\) => \{[\s\S]*?onResolved\(\);/);
  assert.match(
    detailSource,
    /LEGACY_IDENTITY_RESOLUTION_STALE[\s\S]*?The plan has been refreshed/,
  );
  // No optimistic local mutation of the candidate list.
  assert.doesNotMatch(s, /setEntries|onMutate|setQueryData/);
});

// ─── 11: safe error surfacing ───────────────────────────────────────────────

test("11: API errors are mapped to safe messages, never raw server text", () => {
  assert.match(detailSource, /function manualResolutionErrorMessage\(error: unknown\): string \{/);
  for (const code of [
    "LEGACY_IDENTITY_RESOLUTION_EVIDENCE_CONFLICT",
    "LEGACY_IDENTITY_RESOLUTION_STALE",
    "LEGACY_IDENTITY_RESOLUTION_NOT_A_CANDIDATE",
    "STUDENT_NOT_DEACTIVATED",
    "STUDENT_DELETION_PREPARATION_REQUIRED",
    "STUDENT_ALREADY_DELETED",
  ]) {
    assert.match(detailSource, new RegExp(code));
  }
  assert.match(detailSource, /return "Could not record the decision\. Please try again\.";/);
  const s = section();
  assert.match(s, /setError\(manualResolutionErrorMessage\(err\)\)/);
  // The raw error object/response body is never rendered.
  assert.doesNotMatch(s, /\{JSON\.stringify|\{err\.message|\{query\.error\}/);
});

// ─── 13: no free-text notes anywhere ────────────────────────────────────────

test("13: no notes/free-text input exists in the resolution flow (backend accepts none)", () => {
  const s = section();
  assert.doesNotMatch(s, /<Textarea|<Input|<textarea|<input/);
  assert.doesNotMatch(s, /\bnotes?\b/i);
  // The request body carries only the four contract fields.
  assert.match(
    s,
    /data: \{\s*workflowId: plan\.workflowId,\s*domain: pending\.entry\.domain,\s*targetRecordId: pending\.entry\.targetRecordId,\s*decision: pending\.decision,\s*\},/,
  );
  assert.match(
    openapiSource,
    /RecordStudentDeletionManualResolutionRequest:[\s\S]*?required: \[workflowId, domain, targetRecordId, decision\]/,
  );
});

// ─── 14: no ownership-backfill wording ──────────────────────────────────────

test("14: no RECORDING copy claims the historical record has been reassigned, linked, or rewritten", () => {
  // Phase B3B3 narrowed the scope of this guard. Recording a decision still
  // changes nothing, and the recording copy must never imply otherwise. The
  // separate "Apply Confirmed Ownership" action introduced by B3B3 genuinely
  // does change ownership and is REQUIRED to say so — so its own copy is
  // stripped out before this assertion runs.
  const s = section()
    .replace(/const backfillMutation = useApplyStudentDeletionOwnershipBackfill\([\s\S]*?\n  \}\);\n/, "")
    .replace(/const eligibleForBackfillCount[\s\S]*?;\n/, "")
    .replace(/\{canResolve && eligibleForBackfillCount > 0 && \([\s\S]*?\n      \)\}\n/, "")
    .replace(/<AlertDialog open=\{backfillPending\}[\s\S]*?<\/AlertDialog>/, "")
    // This assertion is about user-facing COPY, so comments and the
    // backfill state declaration are not part of what it governs.
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^.*\bbackfillPending\b.*$/gm, "");
  assert.doesNotMatch(
    s,
    /(records? (have|has) been (re)?assigned|ownership (has been|was) (transferred|updated|applied|backfilled)|now belongs to|has been linked to this Student|backfill)/i,
  );
  // And the affirmative statement is present in both surfaces.
  assert.match(s, /it does not change the historical record ownership/i);
  assert.match(
    detailSource,
    /Recording a decision does\s*\n?\s*not change the historical record ownership\./,
  );
});

test("14: no Permanent Delete / tombstone / retention action is introduced by this phase", () => {
  assert.doesNotMatch(detailSource, /aria-label="Permanent(ly)? Delete/i);
  assert.doesNotMatch(detailSource, /useDeleteStudent\b|<TombstoneS|retentionPolicy/);
  assert.match(detailSource, /Permanent deletion execution is not enabled yet\./);
});

// ─── Deletion Impact integration ────────────────────────────────────────────

test("deletion impact surfaces unresolved + conflict counts and does not imply eligibility", () => {
  assert.match(detailSource, /data\.manualResolution\.requiredCount > 0 && \(/);
  assert.match(detailSource, /data\.manualResolution\.unresolvedCount/);
  assert.match(detailSource, /data\.manualResolution\.conflictCount > 0 && \(/);
  assert.match(
    detailSource,
    /Clearing historical ownership resolution does not by itself make this account deletable/,
  );
});

// ─── Contract typing ────────────────────────────────────────────────────────

test("the UI consumes the generated typed client, not a handwritten fetch", () => {
  assert.match(detailSource, /useRecordStudentDeletionManualResolution/);
  assert.match(generatedClient, /export const useRecordStudentDeletionManualResolution = </);
  assert.match(generatedClient, /export function useGetStudentDeletionAttributionPlan</);
  assert.match(section(), /useRecordStudentDeletionManualResolution\(\{/);
});

test("openapi documents the live B3B2E surfaces the UI depends on", () => {
  assert.match(openapiSource, /\/students\/\{id\}\/deletion-attribution-resolutions:/);
  assert.match(openapiSource, /operationId: recordStudentDeletionManualResolution/);
  assert.match(openapiSource, /StudentDeletionLevelBResolutionEntry:/);
  assert.match(openapiSource, /StudentDeletionManualResolutionSummary:/);
  assert.match(openapiSource, /enum: \[NONE, PROVEN_OWNER, NOT_THIS_STUDENT, UNRESOLVED\]/);
  assert.match(openapiSource, /- INDEPENDENT_LEVEL_B_EVIDENCE\n\s+- EVIDENCE_CONFLICT/);
});
