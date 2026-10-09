import { PostgrestClient } from "@supabase/postgrest-js";

/**
 * pgbase speaks the PostgREST protocol, so the official client works unchanged.
 * Requests hit the app origin (proxied to the API); fetch's default
 * `credentials: "same-origin"` sends the session cookie.
 */
export const pgbase = new PostgrestClient(`${window.location.origin}/api/rest`);

function isPostgrestError(
  error: unknown,
): error is Error & { details?: string | null; code?: string } {
  return error instanceof Error && error.name === "PostgrestError";
}

/** Common Postgres error classes worth translating for admins. */
const ERROR_HINTS: Record<string, string> = {
  "23505": "That value already exists.",
  "23503": "Another record still references this one.",
  "23001": "Detach this from its products first.",
  "23514": "The value is outside the allowed range.",
};

/** Turn a thrown PostgREST error into user-facing messages. */
export function pgbaseErrorMessages(error: unknown): string[] {
  if (!isPostgrestError(error)) {
    return ["Something went wrong. Please try again."];
  }
  const hint = error.code ? ERROR_HINTS[error.code] : undefined;
  if (hint) return [hint];
  return [error.details ? `${error.message} (${error.details})` : error.message];
}
