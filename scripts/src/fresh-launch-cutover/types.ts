export type TransferClassification = "transfer" | "exclude" | "decision_required";
export type DomainScope = "general_studio" | "ballet" | "shared" | "mixed";
export type StableIdPolicy = "preserve" | "singleton";
export type SequencePolicy = "advance" | "none";

export interface TransferGroup {
  key: string;
  table: string;
  classification: TransferClassification;
  scope: DomainScope;
  order: number;
  dependencies: string[];
  stableId: StableIdPolicy;
  sequence: SequencePolicy;
  predicate?: string;
  excludedColumns?: string[];
  explanation: string;
}

export interface ExportGroup {
  key: string;
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  hash: string;
}

export interface FreshLaunchExport {
  format: "central-studio-fresh-launch-configuration";
  version: 1;
  manifestVersion: string;
  manifestHash: string;
  sourceMigration: string;
  groups: ExportGroup[];
  contentHash: string;
}
