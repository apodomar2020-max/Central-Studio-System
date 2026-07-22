/**
 * The single authoritative "assignment-ready canonical Class" predicate.
 *
 * Every entitlement gate — Group readiness (adminBalletGroups.ts's
 * assignmentReadyClassCount), Application Group assignment, Activation, and
 * Attendance recording (all three in adminBallet.ts) — must agree on
 * exactly what "ready" means. This module is the only place that
 * definition lives; every gate composes its own groupId/levelId/scheduleId
 * filters on top of it.
 *
 * Because migration 0075 intentionally defers the final DB-level
 * constraints (day/time/duration CHECKs on ballet_schedules — see its header comment for the full Expand
 * rationale), there is currently nothing stopping a Schedule row from being
 * malformed except application-layer write-time validation. These runtime
 * predicates are therefore the ONLY thing standing between a malformed or
 * ambiguous row and a false "ready" signal during the Expand window — they
 * must be authoritative, not advisory.
 */
import { sql, type SQL } from "drizzle-orm";
import { balletClassesTable, balletSchedulesTable } from "@workspace/db";

// Matches adminBalletClasses.ts's TIME_PATTERN exactly (kept as a plain
// string here so it can be reused both as a bound sql`` parameter — see
// scheduleShapeCondition — and verbatim inside the correlated subquery
// text below).
const TIME_FORMAT_PATTERN = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

/**
 * True when the ballet_schedules row already joined into the current query
 * (as balletSchedulesTable, unaliased) is individually well-formed: active
 * status, a valid day, correctly formatted start/end times with
 * start < end, and a duration_mins that is not null, positive, and
 * arithmetically consistent with start/end — exactly what
 * deriveBalletScheduleDuration (adminBalletSchedules.ts) computes at write time.
 *
 * Use this when the query needs to validate one SPECIFIC, already-selected
 * Schedule row (e.g. Attendance's client-submitted balletScheduleId) — not
 * for counting/existence, which is what hasAtLeastOneValidActiveSchedule is
 * for.
 */
export function scheduleShapeCondition(): SQL {
  return sql`(
    ${balletSchedulesTable.status} = 'active'
    and ${balletSchedulesTable.dayOfWeek} between 0 and 6
    and ${balletSchedulesTable.startTime} ~ ${TIME_FORMAT_PATTERN}
    and ${balletSchedulesTable.endTime} ~ ${TIME_FORMAT_PATTERN}
    and ${balletSchedulesTable.startTime} < ${balletSchedulesTable.endTime}
    and ${balletSchedulesTable.durationMins} is not null
    and ${balletSchedulesTable.durationMins} > 0
    and ${balletSchedulesTable.durationMins} = (
      (substring(${balletSchedulesTable.endTime} from 1 for 2)::int * 60 + substring(${balletSchedulesTable.endTime} from 4 for 2)::int)
      - (substring(${balletSchedulesTable.startTime} from 1 for 2)::int * 60 + substring(${balletSchedulesTable.startTime} from 4 for 2)::int)
    )
  )`;
}

/**
 * True when the correlated ballet_classes row (balletClassesTable, already
 * in scope from the outer query) owns at least one Schedule satisfying every
 * condition in scheduleShapeCondition above.
 *
 * Deliberately a correlated COUNT subquery, not a join: a join against
 * ballet_schedules would either drop the Class entirely (0 matches) or
 * multiply it into several output rows (2+ matches), which would silently
 * inflate a Group's assignmentReadyClassCount. Counting sibling rows and
 * requiring count >= 1 preserves one Class as one readiness signal while
 * allowing multiple weekly sessions.
 *
 * The condition list is intentionally duplicated as raw SQL text here
 * (a correlated subquery alias can't reference a drizzle Column bound to
 * the outer, unaliased balletSchedulesTable) — kept in lockstep with
 * scheduleShapeCondition by balletClassEntitlement.test.ts.
 */
export function hasAtLeastOneValidActiveSchedule(): SQL {
  return sql`(
    select count(*) from ballet_schedules s
    where s.class_id = ${balletClassesTable.id}
      and s.status = 'active'
      and s.day_of_week between 0 and 6
      and s.start_time ~ ${TIME_FORMAT_PATTERN}
      and s.end_time ~ ${TIME_FORMAT_PATTERN}
      and s.start_time < s.end_time
      and s.duration_mins is not null
      and s.duration_mins > 0
      and s.duration_mins = (
        (substring(s.end_time from 1 for 2)::int * 60 + substring(s.end_time from 4 for 2)::int)
        - (substring(s.start_time from 1 for 2)::int * 60 + substring(s.start_time from 4 for 2)::int)
      )
  ) >= 1`;
}

/** True when the correlated ballet_classes row has an active Instructor. */
export function hasActiveInstructor(): SQL {
  return sql`exists (select 1 from ballet_instructors i where i.id = ${balletClassesTable.instructorId} and i.is_active = true)`;
}

/** True when the Class owns an active Level and active Group, and the Group belongs to the Level. */
export function hasActiveLevelAndGroup(): SQL {
  return sql`exists (
    select 1
    from ballet_groups g
    inner join ballet_levels l on l.id = ${balletClassesTable.levelId}
    where g.id = ${balletClassesTable.groupId}
      and g.level_id = ${balletClassesTable.levelId}
      and g.is_active = true
      and l.is_active = true
  )`;
}

/**
 * The full "assignment-ready canonical Class" predicate: active, non-legacy,
 * active canonical relationships, and at least one well-formed active Schedule.
 * Compose with groupId/levelId (and, for Attendance, a specific scheduleId
 * plus scheduleShapeCondition) at each call site — this only proves the
 * Class itself qualifies.
 */
export function isAssignmentReadyClass(): SQL {
  return sql`(
    ${balletClassesTable.isActive} = true
    and ${balletClassesTable.isLegacy} = false
    and ${hasActiveLevelAndGroup()}
    and ${hasActiveInstructor()}
    and ${hasAtLeastOneValidActiveSchedule()}
  )`;
}
