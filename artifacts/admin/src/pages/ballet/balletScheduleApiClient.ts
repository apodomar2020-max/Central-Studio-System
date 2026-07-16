/**
 * Ballet Schedules admin API client — extracted from BalletSchedulesPage.tsx
 * so the error-classification logic is testable in isolation (node:test,
 * no DOM/React needed) without pulling in the page's UI dependencies.
 *
 * Distinguishes failure classes so the UI never collapses everything into a
 * single generic toast:
 *   - "validation": a structured 4xx from the API — its `error` message is
 *     already written to be shown to the admin verbatim.
 *   - "server": a structured 5xx from the API (has a JSON body with `code`).
 *   - "gateway": a non-2xx response with no parseable JSON body — a proxy,
 *     load balancer, or crash page, not our API's own error shape.
 *   - "network": fetch itself threw (offline, DNS, CORS preflight failure).
 */
export class AdminApiError extends Error {
  readonly kind: "validation" | "server" | "gateway" | "network";
  readonly status?: number;
  readonly code?: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(kind: AdminApiError["kind"], message: string, opts?: { status?: number; code?: string; fieldErrors?: Record<string, string> }) {
    super(message);
    this.kind = kind;
    this.status = opts?.status;
    this.code = opts?.code;
    this.fieldErrors = opts?.fieldErrors;
  }
}

/**
 * Pure classification of a non-2xx response body — no network I/O, so it's
 * directly unit-testable with fabricated inputs. `adminFetch` below is the
 * thin I/O wrapper that calls this after an actual fetch.
 */
export function classifyErrorResponse(status: number, contentType: string, data: unknown): AdminApiError {
  if (!contentType.includes("application/json")) {
    return new AdminApiError("gateway", "The schedules service returned an unexpected server error.", { status });
  }

  if (data == null || typeof (data as { error?: unknown }).error !== "string") {
    return new AdminApiError("gateway", "The schedules service returned an unexpected server error.", { status });
  }

  const body = data as { error: string; code?: string; fieldErrors?: Record<string, string> };

  if (status >= 500) {
    return new AdminApiError("server", "The schedules service returned an unexpected server error.", { status, code: body.code });
  }
  return new AdminApiError("validation", body.error, { status, code: body.code, fieldErrors: body.fieldErrors });
}

function makeHeaders(token: string | null, apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { "x-api-key": apiKey } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

export async function adminFetch<T>(
  url: string,
  init: RequestInit,
  token: string | null,
  apiKey: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: makeHeaders(token, apiKey) });
  } catch {
    throw new AdminApiError("network", "Unable to reach the schedules service.");
  }

  if (res.ok) return res.json() as Promise<T>;

  const contentType = res.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await res.json().catch(() => null) : null;
  throw classifyErrorResponse(res.status, contentType, data);
}

export function scheduleErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AdminApiError) return err.message;
  return fallback;
}
