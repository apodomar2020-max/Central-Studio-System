/**
 * editorialCore — the small shared spine of the editorial services.
 *
 * Holds the domain error type and the audit helper that EVERY editorial
 * service needs. Extracted in Wave 1.1 for one concrete reason: the posts
 * service now needs the languages service (a translation cannot be
 * published into an inactive language) while the languages service needs
 * the error type and the audit helper. Both living in
 * editorialPostsService.ts would be a genuine import cycle. A leaf module
 * that imports nothing from either breaks it cleanly, instead of relying
 * on ESM hoisting to make a cycle happen to work.
 *
 * editorialPostsService.ts re-exports both symbols, so Wave 1 import sites
 * keep working unchanged.
 */
import {
  logActivityWithActorStrict,
  type ActivityActorSnapshot,
  type ActivityLogEntry,
} from "./activityLog";
import type { DbClient } from "./dbTypes";

/** Domain error carrying the HTTP status the route should answer with. */
export class EditorialRuleError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "EditorialRuleError";
  }
}

/**
 * Permission-catalog module key used for every editorial audit row —
 * content AND settings alike, so one audit filter shows the whole domain's
 * history. (The RBAC *permission* required to perform an action is a
 * separate matter: content is `website.posts`, Languages and Links are
 * `website.settings`. The audit module is a reporting dimension, not a
 * grant.)
 */
export const EDITORIAL_AUDIT_MODULE = "website.posts";
const EDITORIAL_ENTITY_TYPE = "editorial_post";

/**
 * Write an editorial audit row on the given client.
 *
 * Called with a TRANSACTION handle for every state change whose audit row
 * is part of the atomic outcome (publish/archive/restore, language default
 * promotion, link changes). `logActivityWithActorStrict` is the existing
 * activityLog service's transactional variant, which PROPAGATES failures
 * instead of swallowing them — so a failed audit write rolls the state
 * change back and an unaudited transition cannot commit. No shared
 * infrastructure was changed to achieve this in Wave 1, and none was
 * changed in Wave 1.1 either: the strict variant already existed and
 * already accepts an arbitrary client.
 */
export async function auditEditorial(
  client: DbClient,
  actor: ActivityActorSnapshot,
  entry: Omit<ActivityLogEntry, "module" | "entityType"> & { entityType?: string },
): Promise<void> {
  await logActivityWithActorStrict(client, actor, {
    module: EDITORIAL_AUDIT_MODULE,
    entityType: entry.entityType ?? EDITORIAL_ENTITY_TYPE,
    action: entry.action,
    entityId: entry.entityId,
    entityLabel: entry.entityLabel,
    before: entry.before,
    after: entry.after,
    summary: entry.summary,
  });
}
