/**
 * Shared constants for the Indexa Capital MCP server.
 */

export const API_BASE_URL = "https://api.indexacapital.com";

/** Maximum response size in characters before truncation. */
export const CHARACTER_LIMIT = 25000;

/** Default request timeout in milliseconds. */
export const REQUEST_TIMEOUT_MS = 30000;

/** Authentication header name expected by the Indexa Capital API. */
export const AUTH_HEADER = "X-AUTH-TOKEN";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

/** Account status values returned by the API. */
export const ACCOUNT_STATUSES = [
  "init",
  "awaiting",
  "init-failed",
  "pending-contract",
  "pending-pbc",
  "pending-provider",
  "active",
  "inactive",
  "cancelled",
  "cancel-request",
  "deleted",
] as const;

/** Account product types. */
export const ACCOUNT_TYPES = ["mutual", "pension"] as const;
