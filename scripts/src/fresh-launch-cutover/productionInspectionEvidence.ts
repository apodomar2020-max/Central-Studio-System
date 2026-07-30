import { createHash } from "node:crypto";
import { deterministicJson } from "./productionApprovalBundle";
import { scanEvidenceOutput } from "./evidenceOutputScanner";

export const INSPECTION_TOOL_VERSION = "g2a-v1";

export interface ProductionInspectionEvidence {
  toolVersion: string;
  approvedCommit: string;
  manifestVersion: string;
  manifestHash: string;
  approvalBundleHash: string;
  environmentIdentityHash: string;
  inspectionStartedAt: string;
  inspectionEndedAt: string;
  postgresqlVersion: string;
  migrationCount: number;
  latestMigration: string;
  readinessStatus: "ready" | "review_required";
  configurationBlockers: number;
  integrityBlockers: number;
  resetInventoryCounts: Record<string, number>;
  financeAggregateChecksum: string;
  balletAggregateChecksum: string;
  sourceFingerprint: string;
  outputScannerResult: "passed";
  readOnlyProofResult: "passed";
  finalInspectionResult: "PRODUCTION_SOURCE_INSPECTION_READY" | "PRODUCTION_SOURCE_INSPECTION_READY_WITH_DECISIONS" | "PRODUCTION_SOURCE_INSPECTION_BLOCKED";
}

export function validateInspectionEvidence(evidence: ProductionInspectionEvidence): void {
  scanEvidenceOutput(evidence);
  for (const field of [
    evidence.approvalBundleHash,
    evidence.environmentIdentityHash,
    evidence.financeAggregateChecksum,
    evidence.balletAggregateChecksum,
    evidence.sourceFingerprint,
  ]) {
    if (!/^[a-f0-9]{64}$/.test(field)) throw new Error("[fresh-launch-g2a:EVIDENCE_HASH_INVALID]");
  }
}

export function productionInspectionEvidenceHash(evidence: ProductionInspectionEvidence): string {
  validateInspectionEvidence(evidence);
  return createHash("sha256").update(deterministicJson(evidence)).digest("hex");
}
