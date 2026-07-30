const forbiddenKey = /(?:password|passwd|secret|token|database_?url|connection_?string|hostname|host_name|user_?name|email|phone|address|date_?of_?birth|dob|child_?name|payment_?reference|free_?text|notes?)/i;
const suspiciousValue = /(?:postgres(?:ql)?:\/\/|railway\.app|rlwy|-----BEGIN [A-Z ]+PRIVATE KEY-----|(?:^|\s)[^\s@]+@[^\s@]+\.[^\s@]+(?:\s|$)|\b(?:\d{1,3}\.){3}\d{1,3}\b)/i;

export class EvidenceSafetyError extends Error {
  constructor(public readonly code: string, detail?: string) {
    super(`[fresh-launch-g2a:${code}]${detail ? ` ${detail}` : ""}`);
  }
}

export function scanEvidenceOutput(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanEvidenceOutput(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbiddenKey.test(key)) throw new EvidenceSafetyError("FORBIDDEN_EVIDENCE_KEY");
      scanEvidenceOutput(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && suspiciousValue.test(value)) {
    throw new EvidenceSafetyError("SUSPICIOUS_EVIDENCE_VALUE");
  }
}

export function assertSafeReference(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Z0-9][A-Z0-9_.:/-]{2,127}$/i.test(value) || suspiciousValue.test(value)) {
    throw new EvidenceSafetyError(code);
  }
}
