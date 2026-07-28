import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, danceTypesTable, pricePackageDanceTypesTable, pricePackagesTable } from "@workspace/db";
import { diffFields, logActivity } from "../lib/activityLog";
import {
  CreatePricePackageBody,
  GetPricePackageParams,
  GetPricePackageResponse,
  UpdatePricePackageParams,
  UpdatePricePackageBody,
  UpdatePricePackageResponse,
  DeletePricePackageParams,
  ListPricePackagesResponse,
} from "@workspace/api-zod";
import { validateAgeRange } from "../lib/eligibility/ageRange";
import {
  ageRangeMetadata,
  evaluatePackageCatalogueEligibility,
  studentCatalogueVisible,
  type CatalogueViewer,
} from "../lib/eligibility/catalogueEligibility";
import { resolveCatalogueViewer, setCatalogueCacheHeaders } from "../lib/catalogueViewer";

const router: IRouter = Router();
const PRICE_PACKAGE_ACTIVITY_FIELDS = ["name", "type", "priceEgp", "sessions", "description", "isActive", "isFeatured", "validityMonths", "singleClassPriceEgp", "allowedDanceTypes", "allowAllAges", "minAge", "maxAge", "features"] as const;

function validatePackageAgeRange(input: {
  allowAllAges?: boolean | null;
  minAge?: number | null;
  maxAge?: number | null;
}): string | null {
  if (input.allowAllAges == null && input.minAge == null && input.maxAge == null) return null;
  if (input.allowAllAges == null) return "allowAllAges is required when configuring an age range.";
  const result = validateAgeRange({
    allowAllAges: input.allowAllAges,
    minAge: input.minAge ?? null,
    maxAge: input.maxAge ?? null,
  });
  return result.eligible ? null : result.reasons[0]?.message ?? "Invalid age range.";
}

async function loadDanceTypeRestrictions(packageIds: number[]) {
  if (packageIds.length === 0) return new Map<number, Array<{ id: number; name: string; slug: string }>>();
  const rows = await db
    .select({
      packageId: pricePackageDanceTypesTable.packageId,
      id: danceTypesTable.id,
      name: danceTypesTable.name,
      slug: danceTypesTable.slug,
    })
    .from(pricePackageDanceTypesTable)
    .innerJoin(danceTypesTable, eq(pricePackageDanceTypesTable.danceTypeId, danceTypesTable.id))
    .where(inArray(pricePackageDanceTypesTable.packageId, packageIds));
  const byPackage = new Map<number, Array<{ id: number; name: string; slug: string }>>();
  for (const row of rows) {
    const list = byPackage.get(row.packageId) ?? [];
    list.push({ id: row.id, name: row.name, slug: row.slug });
    byPackage.set(row.packageId, list);
  }
  return byPackage;
}

function presentPackage(
  row: typeof pricePackagesTable.$inferSelect,
  danceTypes: Array<{ id: number; name: string; slug: string }>,
  viewer: CatalogueViewer,
) {
  const range = { allowAllAges: row.allowAllAges, minAge: row.minAge, maxAge: row.maxAge };
  const hasLegacyRestriction = row.allowedDanceTypes.length > 0;
  return {
    ...row,
    ...ageRangeMetadata(range),
    allowedDanceTypeIds: danceTypes.map((item) => item.id),
    allowedDanceTypeDetails: danceTypes,
    danceTypeUnrestricted: danceTypes.length === 0 && !hasLegacyRestriction,
    danceTypeConfigurationState: danceTypes.length > 0
      ? "canonical"
      : hasLegacyRestriction ? "legacy_text_only" : "unrestricted",
    catalogueEligibility: evaluatePackageCatalogueEligibility(viewer, range),
  };
}

async function validateDanceTypeIds(ids: number[]): Promise<Array<{ id: number; name: string; slug: string }> | null> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: danceTypesTable.id, name: danceTypesTable.name, slug: danceTypesTable.slug })
    .from(danceTypesTable)
    .where(inArray(danceTypesTable.id, ids));
  return rows.length === ids.length ? rows : null;
}

router.get("/price-packages", async (req, res): Promise<void> => {
  const viewer = await resolveCatalogueViewer(req, res);
  if (!viewer) return;
  setCatalogueCacheHeaders(res, viewer);
  const allRows = await db.select().from(pricePackagesTable).orderBy(pricePackagesTable.createdAt);
  const rows = viewer.kind === "admin" ? allRows : allRows.filter((row) => row.isActive);
  const restrictions = await loadDanceTypeRestrictions(rows.map((row) => row.id));
  const enriched = rows.map((row) => presentPackage(row, restrictions.get(row.id) ?? [], viewer));
  const visible = viewer.kind === "student"
    ? enriched.filter((row) => studentCatalogueVisible(row.catalogueEligibility))
    : enriched;
  res.json(ListPricePackagesResponse.parse(visible));
});

router.post("/price-packages", blockStudentJwt, requireAdminAuth, requireAdminPermission("packages", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreatePricePackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ageError = validatePackageAgeRange(parsed.data);
  if (ageError) {
    res.status(400).json({ error: ageError, code: "AGE_RANGE_INVALID" });
    return;
  }
  const allowedDanceTypeIds = [...new Set(parsed.data.allowedDanceTypeIds ?? [])];
  const canonicalDanceTypes = await validateDanceTypeIds(allowedDanceTypeIds);
  if (!canonicalDanceTypes) {
    res.status(400).json({ error: "One or more dance type IDs are invalid." });
    return;
  }
  const { allowedDanceTypeIds: _ids, ...packageData } = parsed.data;
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(pricePackagesTable).values({
      ...packageData,
      // Temporary mirror for released consumers; canonical IDs are authoritative.
      allowedDanceTypes: canonicalDanceTypes.map((item) => item.name),
    }).returning();
    if (allowedDanceTypeIds.length > 0) {
      await tx.insert(pricePackageDanceTypesTable).values(
        allowedDanceTypeIds.map((danceTypeId) => ({ packageId: created.id, danceTypeId })),
      );
    }
    return created;
  });
  await logActivity(req, {
    action: "create",
    module: "packages",
    entityType: "price_package",
    entityId: row.id,
    entityLabel: row.name,
    after: Object.fromEntries(PRICE_PACKAGE_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    summary: `Created package ${row.name}`,
  });
  res.status(201).json(GetPricePackageResponse.parse(
    presentPackage(row, canonicalDanceTypes, { kind: "admin" }),
  ));
});

router.get("/price-packages/:id", async (req, res): Promise<void> => {
  const viewer = await resolveCatalogueViewer(req, res);
  if (!viewer) return;
  setCatalogueCacheHeaders(res, viewer);
  const params = GetPricePackageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(pricePackagesTable).where(eq(pricePackagesTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Price package not found" });
    return;
  }
  const restrictions = await loadDanceTypeRestrictions([row.id]);
  res.json(GetPricePackageResponse.parse(presentPackage(row, restrictions.get(row.id) ?? [], viewer)));
});

router.patch("/price-packages/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("packages", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const params = UpdatePricePackageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePricePackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(pricePackagesTable).where(eq(pricePackagesTable.id, params.data.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Price package not found" });
    return;
  }
  const candidateRange = {
    allowAllAges: parsed.data.allowAllAges === undefined ? existing.allowAllAges : parsed.data.allowAllAges,
    minAge: parsed.data.minAge === undefined ? existing.minAge : parsed.data.minAge,
    maxAge: parsed.data.maxAge === undefined ? existing.maxAge : parsed.data.maxAge,
  };
  const ageError = validatePackageAgeRange(candidateRange);
  if (ageError) {
    res.status(400).json({ error: ageError, code: "AGE_RANGE_INVALID" });
    return;
  }
  const restrictionWasSupplied = parsed.data.allowedDanceTypeIds !== undefined;
  const allowedDanceTypeIds = [...new Set(parsed.data.allowedDanceTypeIds ?? [])];
  const canonicalDanceTypes = restrictionWasSupplied
    ? await validateDanceTypeIds(allowedDanceTypeIds)
    : null;
  if (restrictionWasSupplied && !canonicalDanceTypes) {
    res.status(400).json({ error: "One or more dance type IDs are invalid." });
    return;
  }
  const { allowedDanceTypeIds: _ids, ...packageData } = parsed.data;
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(pricePackagesTable).set({
      ...packageData,
      ...(restrictionWasSupplied
        ? { allowedDanceTypes: canonicalDanceTypes!.map((item) => item.name) }
        : {}),
    }).where(eq(pricePackagesTable.id, params.data.id)).returning();
    if (!updated) return null;
    if (restrictionWasSupplied) {
      await tx.delete(pricePackageDanceTypesTable).where(
        eq(pricePackageDanceTypesTable.packageId, updated.id),
      );
      if (allowedDanceTypeIds.length > 0) {
        await tx.insert(pricePackageDanceTypesTable).values(
          allowedDanceTypeIds.map((danceTypeId) => ({ packageId: updated.id, danceTypeId })),
        );
      }
    }
    return updated;
  });
  if (!row) {
    res.status(404).json({ error: "Price package not found" });
    return;
  }
  const { before, after } = diffFields(
    Object.fromEntries(PRICE_PACKAGE_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
    Object.fromEntries(PRICE_PACKAGE_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    PRICE_PACKAGE_ACTIVITY_FIELDS,
  );
  const changedKeys = Object.keys(after);
  if (changedKeys.length > 0) {
    const action = existing.isActive !== row.isActive ? row.isActive ? "activate" : "deactivate" : "update";
    await logActivity(req, {
      action,
      module: "packages",
      entityType: "price_package",
      entityId: row.id,
      entityLabel: row.name,
      before,
      after,
      summary: action === "activate"
        ? `Activated package ${row.name}`
        : action === "deactivate"
          ? `Deactivated package ${row.name}`
          : `Updated package ${row.name}: ${changedKeys.join(", ")}`,
    });
  }
  const restrictions = await loadDanceTypeRestrictions([row.id]);
  res.json(UpdatePricePackageResponse.parse(
    presentPackage(row, restrictions.get(row.id) ?? [], { kind: "admin" }),
  ));
});

router.delete("/price-packages/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("packages", "delete"), async (req: AdminRequest, res): Promise<void> => {
  const params = DeletePricePackageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(pricePackagesTable).where(eq(pricePackagesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Price package not found" });
    return;
  }
  await logActivity(req, {
    action: "delete",
    module: "packages",
    entityType: "price_package",
    entityId: row.id,
    entityLabel: row.name,
    before: Object.fromEntries(PRICE_PACKAGE_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    summary: `Deleted package ${row.name}`,
  });
  res.sendStatus(204);
});

export default router;
