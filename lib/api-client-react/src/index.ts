// Orval "single" mode emits one generated/api.ts containing both the hooks
// and the schema types (there is no separate api.schemas.ts).
export * from "./generated/api";
export * from "./media-url";
export { setBaseUrl, setAuthTokenGetter, setAdminTokenGetter, customFetch } from "./custom-fetch";
export type { AuthTokenGetter, CustomFetchOptions } from "./custom-fetch";
