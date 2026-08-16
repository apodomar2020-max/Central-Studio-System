import { useEffect, useState } from "react";

/**
 * useDebouncedValue — was copy-pasted per-file (students.tsx, parents.tsx,
 * admin-activity-logs-panel.tsx, campaign-composer-dialog.tsx,
 * notification-delivery-logs-panel.tsx) with identical implementations.
 * Extracted here as part of the Data Tables Enhancement workstream, which
 * adds several more call sites (Studio + Ballet search inputs) — a pure,
 * zero-business-logic utility, not a page-specific rule, so centralizing it
 * doesn't conflict with "page-specific business rules remain page-local."
 * Existing call sites are left as-is; only new call sites import this.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
