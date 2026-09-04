export const PACKAGE_AGE_BANDS = {
  kids: [5, 12],
  teens: [13, 17],
  adults: [18, null],
} as const;

export type PackageAgeBand = keyof typeof PACKAGE_AGE_BANDS;

export const PACKAGE_AGE_BAND_LABELS: Record<PackageAgeBand, string> = {
  adults: "Adults",
  teens: "Teens",
  kids: "Kids",
};

export function parsePackageAgeBand(value: unknown): PackageAgeBand | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "adult" || normalized === "adults") return "adults";
  if (normalized === "teen" || normalized === "teens") return "teens";
  if (normalized === "kid" || normalized === "kids") return "kids";
  return null;
}

export function packageMatchesAgeBand(
  pkg: {
    allowAllAges: boolean | null;
    minAge: number | null;
    maxAge: number | null;
  },
  band: PackageAgeBand,
): boolean {
  if (pkg.allowAllAges) return true;
  const [bandMin, bandMax] = PACKAGE_AGE_BANDS[band];
  const packageMin = pkg.minAge ?? 0;
  const packageMax = pkg.maxAge ?? Number.POSITIVE_INFINITY;
  const effectiveBandMax = bandMax ?? Number.POSITIVE_INFINITY;
  return packageMin <= effectiveBandMax && packageMax >= bandMin;
}
