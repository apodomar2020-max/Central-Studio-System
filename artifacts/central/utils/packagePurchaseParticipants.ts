import type { PricePackage } from "@workspace/api-client-react";

import type { ChildProfile, PackageParticipantSelection, User } from "@/contexts/AppContext";

export type PackageParticipantOption = {
  key: string;
  name: string;
  type: "self" | "child";
  childId: number | null;
  age: number | null;
  eligible: boolean;
};

function ageOnDate(dob: string | null | undefined, evaluationDate: string): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [year, month, day] = dob.split("-").map(Number);
  const [evaluationYear, evaluationMonth, evaluationDay] = evaluationDate.split("-").map(Number);
  if (!year || !month || !day || !evaluationYear || !evaluationMonth || !evaluationDay) return null;
  let age = evaluationYear - year;
  if (evaluationMonth < month || (evaluationMonth === month && evaluationDay < day)) age -= 1;
  return age < 0 ? null : age;
}

function isEligible(age: number | null, pkg: PricePackage): boolean {
  if (age == null) return false;
  if (pkg.allowAllAges === true) return true;
  if (pkg.allowAllAges == null && pkg.minAge == null && pkg.maxAge == null) return true;
  if (pkg.minAge == null || age < pkg.minAge) return false;
  return pkg.maxAge == null || age <= pkg.maxAge;
}

export function buildPackageParticipantOptions(
  user: User | null,
  children: ChildProfile[],
  pkg: PricePackage,
  evaluationDate: string,
): PackageParticipantOption[] {
  const raw = [
    {
      key: "self",
      name: user?.fullName ?? "My Account",
      type: "self" as const,
      childId: null,
      age: ageOnDate(user?.dateOfBirth, evaluationDate),
    },
    ...(user?.accountType === "parent"
      ? children.map((child) => ({
          key: `child:${child.id}`,
          name: child.fullName,
          type: "child" as const,
          childId: Number(child.id),
          // General Studio eligibility must match the API's canonical column.
          // Legacy birthday and stored numeric age are deliberately ignored.
          age: ageOnDate(child.dateOfBirth, evaluationDate),
        }))
      : []),
  ];

  return raw.map((option) => ({ ...option, eligible: isEligible(option.age, pkg) }));
}

export function participantSelectionFor(
  option: PackageParticipantOption,
): PackageParticipantSelection {
  return option.type === "child"
    ? { participantType: "child", participantChildId: option.childId! }
    : { participantType: "self" };
}
