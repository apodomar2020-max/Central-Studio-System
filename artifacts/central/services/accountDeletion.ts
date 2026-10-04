import * as SecureStore from "expo-secure-store";
import { customFetch } from "@workspace/api-client-react";

const STATUS_KEY = "accountDeletionStatus";
let deletionInProgress = false;
export const isAccountDeletionInProgress = () => deletionInProgress;
const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
export type DeletionStatus = {
  requestId: string; status: "pending" | "completed"; blockers: { key: string; label: string }[];
  appleRevocation: string; appleManualRevocation: string | null; statusToken?: string;
};
export type DeletionDetails = { disclosure: { deleted: string[]; retained: string[]; pending: string }; linkedProviders: string[] };
export const getDeletionDetails = () => customFetch<DeletionDetails>("/api/me/account-deletion");
export const sendDeletionCode = () => customFetch("/api/me/account-deletion/code", { method: "POST" });
export async function reauthenticateDeletion(body: { password?: string; code?: string }) {
  const result = await customFetch<{ deletionProof: string; statusToken: string }>("/api/me/account-deletion/reauth", { method: "POST", body: JSON.stringify(body) });
  // Save the status-only capability before deactivation: a lost deletion response must remain recoverable.
  await SecureStore.setItemAsync(STATUS_KEY, result.statusToken, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return result;
}
export async function submitAccountDeletion(deletionProof: string): Promise<DeletionStatus> {
  deletionInProgress = true;
  try {
  const result = await customFetch<DeletionStatus>("/api/me/account-deletion", { method: "POST", body: JSON.stringify({ deletionProof, confirmation: "DELETE" }) });
  if (result.statusToken) await SecureStore.setItemAsync(STATUS_KEY, result.statusToken, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return result;
  } finally { deletionInProgress = false; }
}
export async function savedDeletionStatus(): Promise<DeletionStatus | null> {
  const statusToken = await SecureStore.getItemAsync(STATUS_KEY);
  if (!statusToken) return null;
  // No Central JWT: deletion already invalidated it.
  const response = await fetch(`${API}/api/account-deletion/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statusToken }) });
  if (!response.ok) return null;
  return response.json();
}
