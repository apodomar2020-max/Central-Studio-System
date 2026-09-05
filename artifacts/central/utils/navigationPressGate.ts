const DEFAULT_NAVIGATION_LOCK_MS = 1_200;
const MAX_TRACKED_TARGETS = 64;

const recentTargets = new Map<string, number>();

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function navigationTargetKey(target: unknown): string {
  if (typeof target === "string") return target;
  try {
    return JSON.stringify(stableValue(target));
  } catch {
    return String(target);
  }
}

/** Atomically claims a destination before Expo Router mutates its stack. */
export function claimNavigationTarget(
  target: unknown,
  now = Date.now(),
  lockMs = DEFAULT_NAVIGATION_LOCK_MS,
): boolean {
  const key = navigationTargetKey(target);
  const previous = recentTargets.get(key);
  if (previous !== undefined && now - previous < lockMs) return false;

  recentTargets.set(key, now);
  if (recentTargets.size > MAX_TRACKED_TARGETS) {
    const expiry = now - lockMs;
    for (const [trackedKey, claimedAt] of recentTargets) {
      if (claimedAt < expiry) recentTargets.delete(trackedKey);
    }
  }
  return true;
}

/** Releases only the matching claim when navigation throws synchronously. */
export function releaseNavigationTarget(target: unknown): void {
  recentTargets.delete(navigationTargetKey(target));
}

export function resetNavigationPressGateForTests(): void {
  recentTargets.clear();
}

