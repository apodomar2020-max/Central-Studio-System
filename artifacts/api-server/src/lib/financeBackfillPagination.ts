import { SOURCE_FAMILIES, type SourceFamily } from "./financeBackfillClassifier";

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 256;

interface CursorPayload {
  v: typeof CURSOR_VERSION;
  f: SourceFamily;
  a: number;
}

export type FinanceBackfillCursorMap = Record<SourceFamily, string | null>;
export type LegacyFinanceBackfillCursorMap = Record<SourceFamily, number | null>;

export interface FinanceBackfillPageInfo {
  hasNextPage: boolean;
  nextCursors: FinanceBackfillCursorMap;
}

function isSourceFamily(value: unknown): value is SourceFamily {
  return typeof value === "string" && (SOURCE_FAMILIES as readonly string[]).includes(value);
}

export function encodeFinanceBackfillCursor(family: SourceFamily, afterId: number): string {
  if (!Number.isSafeInteger(afterId) || afterId < 0) {
    throw new Error("invalid Finance backfill cursor boundary");
  }
  const payload: CursorPayload = { v: CURSOR_VERSION, f: family, a: afterId };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeFinanceBackfillCursor(cursor: string, expectedFamily?: SourceFamily): {
  family: SourceFamily;
  afterId: number;
} {
  const normalized = cursor.trim();
  if (normalized.length === 0 || normalized.length > MAX_CURSOR_LENGTH) {
    throw new Error("invalid Finance backfill cursor");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(normalized, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid Finance backfill cursor");
  }

  if (
    payload === null ||
    typeof payload !== "object" ||
    (payload as Partial<CursorPayload>).v !== CURSOR_VERSION ||
    !isSourceFamily((payload as Partial<CursorPayload>).f) ||
    !Number.isSafeInteger((payload as Partial<CursorPayload>).a) ||
    ((payload as Partial<CursorPayload>).a as number) < 0
  ) {
    throw new Error("invalid Finance backfill cursor");
  }

  const family = (payload as CursorPayload).f;
  const afterId = (payload as CursorPayload).a;
  if (expectedFamily !== undefined && family !== expectedFamily) {
    throw new Error("Finance backfill cursor source does not match");
  }

  // Reject non-canonical encodings and trailing data instead of accepting
  // multiple textual cursors for the same boundary.
  if (encodeFinanceBackfillCursor(family, afterId) !== normalized) {
    throw new Error("invalid Finance backfill cursor");
  }
  return { family, afterId };
}

export function normalizeFinanceBackfillPageInfo(
  cursors: Partial<Record<SourceFamily, number | null>>,
): {
  pageInfo: FinanceBackfillPageInfo;
  legacyNextCursors: LegacyFinanceBackfillCursorMap;
} {
  const legacyNextCursors = Object.fromEntries(
    SOURCE_FAMILIES.map((family) => [family, cursors[family] ?? null]),
  ) as LegacyFinanceBackfillCursorMap;
  const nextCursors = Object.fromEntries(
    SOURCE_FAMILIES.map((family) => {
      const boundary = legacyNextCursors[family];
      return [family, boundary === null ? null : encodeFinanceBackfillCursor(family, boundary)];
    }),
  ) as FinanceBackfillCursorMap;

  return {
    pageInfo: {
      hasNextPage: Object.values(nextCursors).some((cursor) => cursor !== null),
      nextCursors,
    },
    legacyNextCursors,
  };
}
