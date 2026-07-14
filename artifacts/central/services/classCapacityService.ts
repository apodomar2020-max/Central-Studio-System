import { customFetch } from "@workspace/api-client-react";

export interface ClassCapacitySettings {
  classCapacityEnabled: boolean;
  enforcementEnabled: boolean;
  displayEnabled: boolean;
}

export const DEFAULT_CLASS_CAPACITY_ENABLED = true;

export async function fetchClassCapacitySettings(): Promise<ClassCapacitySettings> {
  return customFetch<ClassCapacitySettings>("/api/settings/class-capacity");
}
