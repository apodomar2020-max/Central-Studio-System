import type { Request, Response } from "express";
import { db, studentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CatalogueViewer } from "./eligibility/catalogueEligibility";
import { resolveOptionalAdminIdentity } from "../routes/adminAuth";

export async function resolveCatalogueViewer(
  req: Request,
  res: Response,
): Promise<CatalogueViewer | null> {
  const admin = await resolveOptionalAdminIdentity(req);
  if (admin) return { kind: "admin" };

  if (!req.studentJwtVerified || req.studentId == null) return { kind: "guest" };

  const [account] = await db
    .select({
      id: studentsTable.id,
      accountType: studentsTable.accountType,
      dateOfBirth: studentsTable.dateOfBirth,
    })
    .from(studentsTable)
    .where(eq(studentsTable.id, req.studentId))
    .limit(1);

  if (!account) {
    res.status(401).json({ error: "Authenticated account not found" });
    return null;
  }
  if (account.accountType === "parent") {
    return { kind: "parent", studentId: account.id, dateOfBirth: account.dateOfBirth };
  }
  return { kind: "student", studentId: account.id, dateOfBirth: account.dateOfBirth };
}

export function setCatalogueCacheHeaders(res: Response, viewer: CatalogueViewer): void {
  res.vary("Authorization");
  res.vary("X-Admin-Token");
  if (viewer.kind === "guest") {
    res.setHeader("Cache-Control", "public, max-age=60");
  } else {
    res.setHeader("Cache-Control", "private, no-store");
  }
}
