/**
 * Notifications Wave 3 — Manual Push Campaign audience contract.
 *
 * THE canonical resolver: audienceType + audienceConfig → a normalized,
 * deduplicated set of recipient account IDs. Both previewCampaignAudience()
 * and freezeCampaignRecipients() (notificationCampaigns.ts) call into this
 * exact module — there is deliberately no second, preview-only or
 * send-only resolution path that could silently drift from this one.
 *
 * Architecture: each audience type resolves to a SQL subquery fragment
 * (buildAudienceAccountsSubquery) rather than a materialized JS array of
 * IDs. This keeps every broad segment (all_members, students, parents,
 * ballet_families, package_holders) a single set-based query with memory
 * bounded by Postgres's own query execution, not by holding thousands of
 * IDs in Node — the same set-based INSERT…SELECT discipline Wave 2's
 * original freezeCampaignRecipients established. The two config-driven
 * types (specific_members, class_participants/package_holders=package)
 * embed their parameters directly into the fragment via bound placeholders
 * — never string-concatenated — so this remains safe against SQL injection
 * at any input size.
 *
 * Config validation is layered:
 *   1. Zod shape validation (lib/api-zod's NOTIFICATION_CAMPAIGN_AUDIENCE_CONFIG_SCHEMAS)
 *      — malformed/extra fields rejected before this module ever runs.
 *   2. validateAndNormalizeAudienceConfig (this file) — async, DB-backed
 *      checks a pure Zod schema cannot express: do the referenced IDs
 *      actually exist, does the schedule belong to the class, is the
 *      occurrence date real for that schedule. Runs once, at campaign
 *      create/update time — the resolver trusts an already-validated
 *      config at preview/send time rather than re-doing these checks on
 *      every call.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import {
  classesTable,
  db,
  pricePackagesTable,
  schedulesTable,
  studentsTable,
} from "@workspace/db";
import {
  NOTIFICATION_CAMPAIGN_AUDIENCE_CONFIG_SCHEMAS,
  type NotificationCampaignAudienceConfigByType,
  type NotificationCampaignAudienceType,
} from "@workspace/api-zod";
import { NotificationCampaignError } from "./notificationCampaignError";
import { scheduleOccursOnDate } from "./calendarOccurrence";
import { isValidIsoDate } from "./occurrence";

// ─── Config validation (create/update time only) ─────────────────────────────

/**
 * Zod shape check + audience-specific async DB validation, in one call.
 * Throws NotificationCampaignError("INVALID_AUDIENCE_CONFIG", …) — a 400 at
 * the route layer — on any failure. Returns the normalized config to
 * persist (deduplicated studentIds for specific_members; otherwise the
 * parsed value verbatim).
 */
export async function validateAndNormalizeAudienceConfig<T extends NotificationCampaignAudienceType>(
  audienceType: T,
  rawConfig: unknown,
): Promise<NotificationCampaignAudienceConfigByType[T]> {
  const schema = NOTIFICATION_CAMPAIGN_AUDIENCE_CONFIG_SCHEMAS[audienceType];
  const parsed = schema.safeParse(rawConfig ?? {});
  if (!parsed.success) {
    throw new NotificationCampaignError(
      "INVALID_AUDIENCE_CONFIG",
      `Invalid audienceConfig for audienceType "${audienceType}": ${parsed.error.message}`,
    );
  }

  if (audienceType === "specific_members") {
    const config = parsed.data as NotificationCampaignAudienceConfigByType["specific_members"];
    const uniqueIds = [...new Set(config.studentIds)];
    // "validate all IDs exist" — reject the whole config up front rather
    // than silently sending to fewer accounts than the admin selected; a
    // typo'd/stale ID is far more likely to be a mistake worth surfacing
    // than an intentional partial audience.
    const existingRows = await db.select({ id: studentsTable.id }).from(studentsTable).where(sql`${studentsTable.id} in (${sql.join(uniqueIds.map((id) => sql`${id}`), sql`, `)})`);
    const existingIds = new Set(existingRows.map((r) => r.id));
    const missing = uniqueIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      throw new NotificationCampaignError(
        "INVALID_AUDIENCE_CONFIG",
        `specific_members.studentIds references account id(s) that do not exist: ${missing.join(", ")}`,
      );
    }
    return { studentIds: uniqueIds } as NotificationCampaignAudienceConfigByType[T];
  }

  if (audienceType === "class_participants") {
    const config = parsed.data as NotificationCampaignAudienceConfigByType["class_participants"];
    await validateClassParticipantsConfig(config);
    return config as NotificationCampaignAudienceConfigByType[T];
  }

  if (audienceType === "package_holders") {
    const config = parsed.data as NotificationCampaignAudienceConfigByType["package_holders"];
    if (config.scope === "package") {
      const [row] = await db.select({ id: pricePackagesTable.id }).from(pricePackagesTable).where(eq(pricePackagesTable.id, config.packageId)).limit(1);
      if (!row) {
        throw new NotificationCampaignError("INVALID_AUDIENCE_CONFIG", `package_holders.packageId ${config.packageId} does not reference an existing package.`);
      }
    }
    return config as NotificationCampaignAudienceConfigByType[T];
  }

  return parsed.data as NotificationCampaignAudienceConfigByType[T];
}

/**
 * class_participants' three checks a shape-only schema cannot express:
 *   1. the schedule actually belongs to the given class (rejects a
 *      schedule/class combination copy-pasted from different pickers)
 *   2. the schedule was not CANCELLED — "target isn't a cancelled/inactive
 *      occurrence". Wave 3.1 concurrency/business-rule review: this
 *      deliberately checks status !== 'cancelled', NOT status === 'active'.
 *      routes/schedules.ts's syncAutomaticScheduleStatuses() auto-flips a
 *      one-time schedule to 'expired' the moment its own date+time passes
 *      (Cairo time) — a purely time-based, inevitable, silent transition
 *      that every one-time schedule eventually gets, not an admin decision
 *      that anything is wrong. 'cancelled' is the opposite: an explicit
 *      admin action that also fires a "Class cancelled" notification to
 *      existing bookings (routes/schedules.ts) — the one status that
 *      genuinely means "this occurrence's data is defunct, do not act on
 *      it." Rejecting 'expired'/'completed' too would make Class
 *      Participants unable to message people about a class that already
 *      happened — exactly the "send a follow-up right after today's class"
 *      use case a Manual Push feature exists for — and would inconsistently
 *      block a JUST-CONCLUDED one-time class while leaving a past occurrence
 *      of a still-'active' WEEKLY schedule fully targetable (weekly
 *      schedules have no equivalent auto-expiry), an arbitrary inconsistency
 *      with no product rationale behind it. 'completed' has no producer
 *      anywhere in the codebase today (reserved, like notification_campaigns'
 *      "ready") — treated the same as 'expired' for the same reason.
 *   3. the occurrenceDate is a real projected date for that schedule — the
 *      EXACT function (scheduleOccursOnDate) routes/dashboard.ts's "upcoming
 *      classes" widget and calendarOccurrence.ts already use, so this can
 *      never drift onto a different, subtly-incompatible notion of
 *      "legitimate occurrence" than the rest of the app. Operates purely on
 *      the "YYYY-MM-DD" calendar-date string — no UTC/local conversion, the
 *      same Cairo-safe convention occurrenceDate is stored with everywhere
 *      else (bookings.occurrence_date).
 */
export async function validateClassParticipantsConfig(config: { classId: number; scheduleId: number; occurrenceDate: string }): Promise<void> {
  if (!isValidIsoDate(config.occurrenceDate)) {
    throw new NotificationCampaignError("INVALID_AUDIENCE_CONFIG", `class_participants.occurrenceDate "${config.occurrenceDate}" is not a valid calendar date.`);
  }

  const [schedule] = await db.select().from(schedulesTable).where(eq(schedulesTable.id, config.scheduleId)).limit(1);
  if (!schedule) {
    throw new NotificationCampaignError("INVALID_AUDIENCE_CONFIG", `class_participants.scheduleId ${config.scheduleId} does not exist.`);
  }
  if (schedule.classId !== config.classId) {
    throw new NotificationCampaignError("INVALID_AUDIENCE_CONFIG", `Schedule ${config.scheduleId} does not belong to class ${config.classId}.`);
  }

  const [classRow] = await db.select({ id: classesTable.id }).from(classesTable).where(eq(classesTable.id, config.classId)).limit(1);
  if (!classRow) {
    throw new NotificationCampaignError("INVALID_AUDIENCE_CONFIG", `class_participants.classId ${config.classId} does not exist.`);
  }

  if (schedule.status === "cancelled") {
    throw new NotificationCampaignError("INVALID_AUDIENCE_CONFIG", `Schedule ${config.scheduleId} was cancelled — cannot target it for a campaign.`);
  }

  // schedules.type has no DB-level CHECK constraint (unlike bookingStatus),
  // so it is only a plain `string` at the type level even though every
  // real row is "weekly" or "one_time" (routes/schedules.ts's own
  // SCHEDULE_STATUSES-adjacent convention) — narrow defensively rather
  // than casting blind, so a genuinely corrupt row fails loudly here
  // instead of silently miscomputing occurrence legitimacy.
  if (schedule.type !== "weekly" && schedule.type !== "one_time") {
    throw new NotificationCampaignError("INVALID_AUDIENCE_CONFIG", `Schedule ${config.scheduleId} has an unrecognized type "${schedule.type}".`);
  }

  if (!scheduleOccursOnDate({ ...schedule, type: schedule.type }, config.occurrenceDate)) {
    throw new NotificationCampaignError("INVALID_AUDIENCE_CONFIG", `${config.occurrenceDate} is not a real occurrence of schedule ${config.scheduleId}.`);
  }
}

// ─── The canonical resolver ───────────────────────────────────────────────────

/**
 * audienceType + (already-validated) audienceConfig → a SQL subquery
 * fragment yielding one row per distinct recipient account, column
 * `student_id`. Embedded directly into both previewCampaignAudience's
 * aggregate query and freezeCampaignRecipients' INSERT…SELECT — see this
 * file's top doc comment for why that sharing is the entire point.
 *
 * Every branch is deterministic and deduplicated (DISTINCT / a single
 * per-account row shape) and requires no push-token or device lookup to
 * determine WHO matched — device/Push stats are layered on afterward by
 * the caller, exactly as Wave 2 already did for "all".
 */
export function buildAudienceAccountsSubquery(
  audienceType: NotificationCampaignAudienceType,
  audienceConfig: unknown,
): SQL {
  switch (audienceType) {
    case "all":
    case "all_members":
      // All real Central Studio member accounts — every row in students,
      // no Push-device requirement (device capability is reported
      // separately by the caller), no filter invented beyond "the account
      // exists" (see this file's audience-contract report §4 for why: the
      // codebase has no deleted/blocked/disabled flag on students, so
      // "exists" is the strongest safe definition, matching Wave 2's
      // original "all" resolver exactly).
      return sql`(select id as student_id from students)`;

    case "specific_members": {
      const config = audienceConfig as NotificationCampaignAudienceConfigByType["specific_members"];
      const ids = [...new Set(config.studentIds)];
      if (ids.length === 0) {
        // Structurally unreachable (schema requires min 1, validated at
        // write time) — defensive empty-set fallback, never a live query.
        return sql`(select id as student_id from students where false)`;
      }
      return sql`(select id as student_id from students where id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}))`;
    }

    case "students":
      // Existing project convention (routes/students.ts, marketing.ts):
      // legacy NULL accountType is treated as 'student'.
      return sql`(select id as student_id from students where coalesce(account_type, 'student') = 'student')`;

    case "parents":
      return sql`(select id as student_id from students where account_type = 'parent')`;

    case "ballet_families":
      // Canonical active-enrollment source: ballet_level_assignments.status
      // = 'active' (doc comment: "active enrollment records"). Deliberately
      // NOT balletApplications.status — an accepted/active APPLICATION with
      // no actual level assignment row does not count (see this file's
      // report §8). child_id -> children.parent_id resolves every Ballet
      // child to the Push-addressable account; DISTINCT collapses a parent
      // with multiple active Ballet children to one recipient.
      return sql`(
        select distinct c.parent_id as student_id
        from ballet_level_assignments bla
        join children c on c.id = bla.child_id
        where bla.status = 'active' and c.parent_id is not null
      )`;

    case "class_participants": {
      const config = audienceConfig as NotificationCampaignAudienceConfigByType["class_participants"];
      // scheduleId alone is the precise targeting key once
      // validateClassParticipantsConfig has already proven it belongs to
      // classId — no need to re-filter by classId here (bookings doesn't
      // even reliably carry classId for every historical row shape, while
      // scheduleId + occurrenceDate is the exact identity Wave 1/2's own
      // "one booking = one student + schedule + occurrence" model uses).
      // account_owner_student_id is already the resolved Push-addressable
      // owner for both self- and child-participant bookings (see
      // bookings.ts's doc comment) — DISTINCT collapses an account with
      // multiple qualifying bookings for this exact occurrence to one
      // recipient.
      return sql`(
        select distinct b.account_owner_student_id as student_id
        from bookings b
        where b.schedule_id = ${config.scheduleId}
          and b.occurrence_date = ${config.occurrenceDate}
          and b.booking_status = 'confirmed'
          and b.account_owner_student_id is not null
      )`;
    }

    case "package_holders": {
      const config = audienceConfig as NotificationCampaignAudienceConfigByType["package_holders"];
      // Canonical "currently usable package" condition — the exact
      // status='active' AND remainingCredits>0 pair already used live
      // elsewhere (attendanceResolver.ts's package-eligibility check),
      // not a redundant expiresAt re-check: the package-credit-expiration
      // worker keeps `status` authoritative, so duplicating an expiresAt
      // comparison here would risk drifting onto "slightly different
      // rules" than that existing business logic, which the task
      // explicitly warns against. Regular Studio package_orders ONLY —
      // Ballet subscriptions live in an entirely separate table
      // (ballet_payments) never referenced here.
      if (config.scope === "package") {
        return sql`(
          select distinct po.student_id as student_id
          from package_orders po
          where po.status = 'active' and po.remaining_credits > 0
            and po.package_id = ${config.packageId}
            and po.student_id is not null
        )`;
      }
      return sql`(
        select distinct po.student_id as student_id
        from package_orders po
        where po.status = 'active' and po.remaining_credits > 0
          and po.student_id is not null
      )`;
    }

    default: {
      const exhaustiveCheck: never = audienceType;
      throw new NotificationCampaignError("UNSUPPORTED_AUDIENCE_TYPE", `audienceType "${String(exhaustiveCheck)}" is not supported.`);
    }
  }
}
