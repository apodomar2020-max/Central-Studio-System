// Crash diagnostics keep stack frames and technical types, not arbitrary API payloads or account data.
export function scrubCrashEvent<T extends { message?: unknown; contexts?: unknown; user?: unknown; request?: unknown; extra?: unknown; breadcrumbs?: unknown; exception?: { values?: Array<{ value?: string; type?: string }> } }>(event: T): T {
  delete event.user; delete event.request; delete event.extra; delete event.breadcrumbs;
  delete event.message; delete event.contexts;
  for (const exception of event.exception?.values ?? []) exception.value = "Application error (details removed for privacy)";
  return event;
}
