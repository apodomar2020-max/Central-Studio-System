/**
 * editorialLanguagesService — Website Settings > Languages (Wave 1.1).
 *
 * The language registry behind multilingual editorial content. A language
 * is a WEBSITE-level setting, not a per-channel one: the same set serves
 * both the 'news' and 'experience' channels.
 *
 * THE FOUR INVARIANTS THIS FILE EXISTS TO GUARANTEE
 *
 * 1. EXACTLY ONE DEFAULT, ATOMICALLY. Promoting a language to default
 *    demotes the incumbent and promotes the successor in ONE transaction,
 *    with both rows taken under `SELECT ... FOR UPDATE` row locks FIRST so
 *    two concurrent promotions serialize instead of interleaving. The
 *    database has the final say regardless: the partial unique index
 *    `editorial_languages_single_default` (UNIQUE (is_default) WHERE
 *    is_default) makes two default rows impossible to commit even if this
 *    code were bypassed entirely. Note the demote MUST be flushed before
 *    the promote — the index is checked per statement, so promoting first
 *    would collide with the incumbent.
 *
 * 2. THE DEFAULT CANNOT BE DEACTIVATED. Rejected here with a message
 *    telling the editor what to do instead (promote another ACTIVE
 *    language to default first). The `editorial_languages_default_is_active`
 *    CHECK is the database backstop that makes the illegal end state
 *    unrepresentable rather than merely unreachable.
 *
 * 3. NO PUBLISHING INTO AN INACTIVE LANGUAGE. `assertLanguagePublishable`
 *    is called from the translation publish gate.
 *
 * 4. DEACTIVATION NEVER REWRITES CONTENT. Deactivating a language touches
 *    exactly one row — the language's own. No translation's `status` is
 *    read or written, so an already-published Arabic translation stays
 *    published; the language is simply excluded from new-translation
 *    pickers and from further publishing. Reactivating is likewise a
 *    single-row update and cannot resurrect or alter any translation's
 *    stored status.
 *
 * Languages are never deleted. `editorial_post_translations.language_id`
 * is ON DELETE RESTRICT, so the database refuses a delete that would
 * strip a language out from under content; retirement is
 * `is_active = false`. No delete path exists in this service or its routes.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  db,
  editorialLanguagesTable,
  editorialPostTranslationsTable,
  canonicalizeEditorialLanguageCode,
  type EditorialLanguage,
  type EditorialLanguageDirection,
} from "@workspace/db";
import type { DbClient } from "./dbTypes";
import { EditorialRuleError, auditEditorial } from "./editorialCore";
import type { ActivityActorSnapshot } from "./activityLog";

const LANGUAGE_ENTITY_TYPE = "editorial_language";

export interface LanguageActorContext {
  actor: ActivityActorSnapshot;
  actorAdminId: number | null;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function listLanguages(
  client: DbClient = db,
  opts: { activeOnly?: boolean } = {},
): Promise<EditorialLanguage[]> {
  return client
    .select()
    .from(editorialLanguagesTable)
    .where(opts.activeOnly ? eq(editorialLanguagesTable.isActive, true) : undefined)
    .orderBy(asc(editorialLanguagesTable.displayOrder), asc(editorialLanguagesTable.code));
}

export async function loadLanguageOrThrow(client: DbClient, languageId: number): Promise<EditorialLanguage> {
  const [row] = await client
    .select()
    .from(editorialLanguagesTable)
    .where(eq(editorialLanguagesTable.id, languageId))
    .limit(1);
  if (!row) throw new EditorialRuleError(`Language ${languageId} not found.`, 404);
  return row;
}

/**
 * Resolve a language by its code. Codes are canonicalized first, so "EN-gb"
 * and "en-GB" both find the one row — the API accepts a language CODE in
 * the translation route path (see adminEditorial.ts) because a code is what
 * an editor and a URL both naturally carry.
 */
export async function loadLanguageByCodeOrThrow(client: DbClient, rawCode: string): Promise<EditorialLanguage> {
  const code = canonicalizeEditorialLanguageCode(rawCode);
  const [row] = await client
    .select()
    .from(editorialLanguagesTable)
    .where(eq(editorialLanguagesTable.code, code))
    .limit(1);
  if (!row) throw new EditorialRuleError(`Language "${rawCode}" is not registered.`, 404);
  return row;
}

/**
 * A language may only be NEWLY used (a new translation) while active. Does
 * not affect translations that already exist in it — history is never
 * rewritten.
 */
export async function assertLanguageAssignable(client: DbClient, languageId: number): Promise<EditorialLanguage> {
  const language = await loadLanguageOrThrow(client, languageId);
  if (!language.isActive) {
    throw new EditorialRuleError(
      `Language "${language.name}" is inactive — reactivate it before adding a new translation in it.`,
    );
  }
  return language;
}

/** Publish gate: a translation cannot go live in a deactivated language. */
export async function assertLanguagePublishable(client: DbClient, languageId: number): Promise<EditorialLanguage> {
  const language = await loadLanguageOrThrow(client, languageId);
  if (!language.isActive) {
    throw new EditorialRuleError(
      `Language "${language.name}" is inactive — a translation cannot be published in it.`,
    );
  }
  return language;
}

// ─── Create / edit ──────────────────────────────────────────────────────────

export interface CreateLanguageInput {
  code: string;
  name: string;
  nativeName: string;
  direction: EditorialLanguageDirection;
  displayOrder?: number;
  isActive?: boolean;
  /** When true, this language becomes the default, atomically demoting the incumbent. */
  isDefault?: boolean;
}

export async function createLanguage(
  input: CreateLanguageInput,
  ctx: LanguageActorContext,
): Promise<EditorialLanguage> {
  const code = canonicalizeEditorialLanguageCode(input.code);

  return db.transaction(async (tx) => {
    // A language created AS the default must be active — the same rule the
    // DB CHECK enforces, surfaced here with a usable message.
    const wantsDefault = input.isDefault === true;
    const isActive = wantsDefault ? true : input.isActive ?? true;
    if (wantsDefault && input.isActive === false) {
      throw new EditorialRuleError("The default language must be active.");
    }

    if (wantsDefault) {
      // Demote the incumbent FIRST and in this same transaction, under a
      // row lock, so the partial unique index is never transiently
      // violated and a concurrent promotion serializes behind us.
      const [incumbent] = await tx
        .select()
        .from(editorialLanguagesTable)
        .where(eq(editorialLanguagesTable.isDefault, true))
        .limit(1)
        .for("update");
      if (incumbent) {
        await tx
          .update(editorialLanguagesTable)
          .set({ isDefault: false, updatedByAdminId: ctx.actorAdminId })
          .where(eq(editorialLanguagesTable.id, incumbent.id));
      }
    }

    const [row] = await tx
      .insert(editorialLanguagesTable)
      .values({
        code,
        name: input.name,
        nativeName: input.nativeName,
        direction: input.direction,
        isActive,
        isDefault: wantsDefault,
        displayOrder: input.displayOrder ?? 0,
        updatedByAdminId: ctx.actorAdminId,
      })
      .returning();

    await auditEditorial(tx, ctx.actor, {
      action: "language_created",
      entityType: LANGUAGE_ENTITY_TYPE,
      entityId: row.id,
      entityLabel: row.code,
      after: languageAuditFields(row),
      summary: `Added website language ${row.code} (${row.name}, ${row.direction})`,
    });
    if (wantsDefault) {
      await auditEditorial(tx, ctx.actor, {
        action: "language_default_changed",
        entityType: LANGUAGE_ENTITY_TYPE,
        entityId: row.id,
        entityLabel: row.code,
        after: { isDefault: true },
        summary: `Made ${row.code} the default website language`,
      });
    }
    return row;
  });
}

export interface UpdateLanguageInput {
  name?: string;
  nativeName?: string;
  direction?: EditorialLanguageDirection;
  displayOrder?: number;
}

/**
 * Presentation-only edit. Deliberately CANNOT change `code`, `isActive`, or
 * `isDefault`: the code is the identity every stored translation is keyed
 * to, and the two flags are lifecycle transitions with their own invariants
 * and their own audit events (setDefaultLanguage / setLanguageActive).
 * Folding them into a generic PATCH is how single-default races and
 * unaudited deactivations get introduced.
 */
export async function updateLanguage(
  languageId: number,
  input: UpdateLanguageInput,
  ctx: LanguageActorContext,
): Promise<EditorialLanguage> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(editorialLanguagesTable)
      .where(eq(editorialLanguagesTable.id, languageId))
      .limit(1)
      .for("update");
    if (!existing) throw new EditorialRuleError(`Language ${languageId} not found.`, 404);

    const updates: Record<string, unknown> = { updatedByAdminId: ctx.actorAdminId };
    for (const key of ["name", "nativeName", "direction", "displayOrder"] as const) {
      if (input[key] !== undefined) updates[key] = input[key];
    }

    const [row] = await tx
      .update(editorialLanguagesTable)
      .set(updates)
      .where(eq(editorialLanguagesTable.id, languageId))
      .returning();

    await auditEditorial(tx, ctx.actor, {
      action: "language_edited",
      entityType: LANGUAGE_ENTITY_TYPE,
      entityId: row.id,
      entityLabel: row.code,
      before: languageAuditFields(existing),
      after: languageAuditFields(row),
      summary: `Updated website language ${row.code}`,
    });
    return row;
  });
}

// ─── Default promotion ──────────────────────────────────────────────────────

/**
 * Promote one language to default, atomically.
 *
 * Ordering is load-bearing: the incumbent is LOCKED and DEMOTED before the
 * successor is promoted. Postgres evaluates the partial unique index per
 * statement, so promoting first would collide with the still-default
 * incumbent; and holding both row locks for the whole transaction is what
 * makes two concurrent promotions serialize rather than both read
 * "incumbent = X" and both try to demote it.
 *
 * The target must be ACTIVE — the default language is always active.
 */
export async function setDefaultLanguage(
  languageId: number,
  ctx: LanguageActorContext,
): Promise<EditorialLanguage> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(editorialLanguagesTable)
      .where(eq(editorialLanguagesTable.id, languageId))
      .limit(1)
      .for("update");
    if (!target) throw new EditorialRuleError(`Language ${languageId} not found.`, 404);
    if (target.isDefault) {
      throw new EditorialRuleError(`"${target.name}" is already the default language.`, 409);
    }
    if (!target.isActive) {
      throw new EditorialRuleError(
        `"${target.name}" is inactive — reactivate it before making it the default language.`,
      );
    }

    const [incumbent] = await tx
      .select()
      .from(editorialLanguagesTable)
      .where(and(eq(editorialLanguagesTable.isDefault, true), ne(editorialLanguagesTable.id, languageId)))
      .limit(1)
      .for("update");

    // Demote FIRST — see the comment above.
    if (incumbent) {
      await tx
        .update(editorialLanguagesTable)
        .set({ isDefault: false, updatedByAdminId: ctx.actorAdminId })
        .where(eq(editorialLanguagesTable.id, incumbent.id));
    }

    const [row] = await tx
      .update(editorialLanguagesTable)
      .set({ isDefault: true, updatedByAdminId: ctx.actorAdminId })
      .where(eq(editorialLanguagesTable.id, languageId))
      .returning();

    await auditEditorial(tx, ctx.actor, {
      action: "language_default_changed",
      entityType: LANGUAGE_ENTITY_TYPE,
      entityId: row.id,
      entityLabel: row.code,
      before: { defaultLanguage: incumbent?.code ?? null },
      after: { defaultLanguage: row.code },
      summary: `Default website language changed${incumbent ? ` from ${incumbent.code}` : ""} to ${row.code}`,
    });
    return row;
  });
}

// ─── Activate / deactivate ──────────────────────────────────────────────────

/**
 * Flip `is_active`.
 *
 * Deactivating the CURRENT DEFAULT is rejected: there would be no default
 * language left, or an inactive one. The editor must promote another
 * ACTIVE language to default first — and `setDefaultLanguage` does that
 * atomically, so the two-step is safe to perform back to back.
 *
 * Deactivating the LAST remaining active language is also rejected: a
 * website with no active language can render no content and cannot be
 * recovered through the content routes.
 *
 * NOTHING about any translation is read or written here. That is the point:
 * `is_active` is a picker/publish gate, never a content mutation.
 */
export async function setLanguageActive(
  languageId: number,
  isActive: boolean,
  ctx: LanguageActorContext,
): Promise<EditorialLanguage> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(editorialLanguagesTable)
      .where(eq(editorialLanguagesTable.id, languageId))
      .limit(1)
      .for("update");
    if (!existing) throw new EditorialRuleError(`Language ${languageId} not found.`, 404);
    if (existing.isActive === isActive) {
      throw new EditorialRuleError(
        `"${existing.name}" is already ${isActive ? "active" : "inactive"}.`,
        409,
      );
    }

    if (!isActive) {
      if (existing.isDefault) {
        throw new EditorialRuleError(
          `"${existing.name}" is the default website language and cannot be deactivated. Make another active language the default first, then deactivate this one.`,
          409,
        );
      }
      const [{ activeCount }] = await tx
        .select({ activeCount: sql<number>`count(*)` })
        .from(editorialLanguagesTable)
        .where(eq(editorialLanguagesTable.isActive, true));
      if (Number(activeCount) <= 1) {
        throw new EditorialRuleError(
          `"${existing.name}" is the only active website language and cannot be deactivated.`,
          409,
        );
      }
    }

    const [row] = await tx
      .update(editorialLanguagesTable)
      .set({ isActive, updatedByAdminId: ctx.actorAdminId })
      .where(eq(editorialLanguagesTable.id, languageId))
      .returning();

    await auditEditorial(tx, ctx.actor, {
      action: isActive ? "language_activated" : "language_deactivated",
      entityType: LANGUAGE_ENTITY_TYPE,
      entityId: row.id,
      entityLabel: row.code,
      before: { isActive: existing.isActive },
      after: { isActive: row.isActive },
      summary: `${isActive ? "Activated" : "Deactivated"} website language ${row.code} (existing translations are unchanged)`,
    });
    return row;
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function languageAuditFields(row: EditorialLanguage): Record<string, unknown> {
  return {
    code: row.code,
    name: row.name,
    nativeName: row.nativeName,
    direction: row.direction,
    isActive: row.isActive,
    isDefault: row.isDefault,
    displayOrder: row.displayOrder,
  };
}

/**
 * How many translations exist in a language, by status. Used by the Admin
 * list so an editor can see what deactivating would take out of new-content
 * circulation before they do it.
 */
export async function countTranslationsByLanguage(
  client: DbClient = db,
): Promise<Array<{ languageId: number; status: string; count: number }>> {
  const rows = await client
    .select({
      languageId: editorialPostTranslationsTable.languageId,
      status: editorialPostTranslationsTable.status,
      count: sql<number>`count(*)`,
    })
    .from(editorialPostTranslationsTable)
    .groupBy(editorialPostTranslationsTable.languageId, editorialPostTranslationsTable.status);
  return rows.map((row) => ({ ...row, count: Number(row.count) }));
}
