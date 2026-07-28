import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  classesTable,
  creditTransactionsTable,
  db,
  packageOrdersTable,
  pricePackageDanceTypesTable,
  pricePackagesTable,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";

const router: IRouter = Router();

function rangeIsInvalid(row: {
  allowAllAges: boolean | null;
  minAge: number | null;
  maxAge: number | null;
}): boolean {
  if (row.allowAllAges == null) return row.minAge != null || row.maxAge != null;
  if (row.allowAllAges) return row.minAge != null || row.maxAge != null;
  return row.minAge == null
    || row.minAge < 0
    || row.minAge > 150
    || (row.maxAge != null && (row.maxAge < row.minAge || row.maxAge > 150));
}

router.get(
  "/admin/catalogue-readiness",
  requireAdminAuth,
  requireAdminPermission("settings", "view"),
  async (_req, res): Promise<void> => {
    const [classes, packages, canonicalRestrictions, packageOrders, creditTransactions] = await Promise.all([
      db.select().from(classesTable),
      db.select().from(pricePackagesTable),
      db.select({ packageId: pricePackageDanceTypesTable.packageId })
        .from(pricePackageDanceTypesTable)
        .innerJoin(pricePackagesTable, eq(pricePackageDanceTypesTable.packageId, pricePackagesTable.id)),
      db.select().from(packageOrdersTable),
      db.select().from(creditTransactionsTable),
    ]);
    const restrictedPackageIds = new Set(canonicalRestrictions.map((row) => row.packageId));
    const activeClasses = classes.filter((row) => row.isActive);
    const activePackages = packages.filter((row) => row.isActive);
    const groups = {
      activeClassesUnconfiguredAge: activeClasses
        .filter((row) => row.allowAllAges == null && row.minAge == null && row.maxAge == null)
        .map((row) => row.id),
      activePackagesUnconfiguredAge: activePackages
        .filter((row) => row.allowAllAges == null && row.minAge == null && row.maxAge == null)
        .map((row) => row.id),
      activeClassesMissingCanonicalDanceType: activeClasses
        .filter((row) => row.danceTypeId == null)
        .map((row) => row.id),
      packagesWithLegacyRestrictionOnly: activePackages
        .filter((row) => row.allowedDanceTypes.length > 0 && !restrictedPackageIds.has(row.id))
        .map((row) => row.id),
      classesWithInvalidAgeRange: activeClasses.filter(rangeIsInvalid).map((row) => row.id),
      packagesWithInvalidAgeRange: activePackages.filter(rangeIsInvalid).map((row) => row.id),
      legacyUnassignedPackageOrders: packageOrders
        .filter((row) => row.participantType == null && row.participantChildId == null)
        .map((row) => row.id),
      invalidPackageOrderParticipantShape: packageOrders
        .filter((row) => !(
          (row.participantType == null && row.participantChildId == null)
          || (row.participantType === "self" && row.participantChildId == null)
          || (row.participantType === "child" && row.participantChildId != null)
        ))
        .map((row) => row.id),
      participantOwnedOrdersMissingSnapshots: packageOrders
        .filter((row) => row.participantType != null && (
          row.participantNameSnapshot == null
          || row.participantDateOfBirthSnapshot == null
          || row.participantAgeAtPurchase == null
          || row.eligibilityEvaluatedOn == null
          || row.purchaseEligibilityConfigurationState == null
        ))
        .map((row) => row.id),
      invalidCreditParticipantShape: creditTransactions
        .filter((row) => !(
          (row.participantType == null && row.participantChildId == null)
          || (row.participantType === "self" && row.participantChildId == null)
          || (row.participantType === "child" && row.participantChildId != null)
        ))
        .map((row) => row.id),
      activationCreditParticipantMismatch: creditTransactions
        .filter((credit) => {
          if (credit.type !== "package_activated") return false;
          const order = packageOrders.find((candidate) => candidate.id === credit.packageOrderId);
          return !order
            || order.participantType !== credit.participantType
            || order.participantChildId !== credit.participantChildId;
        })
        .map((row) => row.id),
    };
    res.json({
      ready: Object.values(groups).every((ids) => ids.length === 0),
      generatedAt: new Date().toISOString(),
      counts: Object.fromEntries(Object.entries(groups).map(([key, ids]) => [key, ids.length])),
      ids: groups,
    });
  },
);

export default router;
