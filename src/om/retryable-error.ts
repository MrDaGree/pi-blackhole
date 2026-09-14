/**
 * Shared retryable-error regex and detection function.
 *
 * Extracted from compaction-trigger.ts and cooldown.ts which had diverging
 * copies of the same logic. This is the single source of truth.
 *
 * Now also re-exports Pi's context-overflow detection from @earendil-works/pi-ai,
 * avoiding the need to duplicate 20+ provider-specific overflow patterns.
 */

/** Regex matching retryable API error messages. */
export const RETRYABLE_ERROR_RE =
  /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;

/** Check whether an error string or Error indicates a retryable error. */
export function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return RETRYABLE_ERROR_RE.test(message);
}

/**
 * Deterministic client errors: retrying the same model cannot succeed without
 * a config/header fix (missing provider-required headers, bad credentials,
 * unknown model, rejected payload). Unlike transient `isRetryableError`
 * failures (same model, later), these must engage the fallback chain and
 * cool the broken model down instead of burning every consolidation cycle.
 *
 * Anchored on explicit signals to avoid false positives from token counts
 * (e.g. "~401-token chunk") — bare status codes only match with an
 * error framing (`HTTP 400`, `status: 404`, `error: 422`).
 */
export const DETERMINISTIC_ERROR_RE =
  /MissingSessionID|missing.?session|invalid.?api.?key|unauthorized|HTTP\s+40[014]\b|HTTP\s+4(?:03|22)\b|status\s*:?\s*40[014]\b|status\s*:?\s*4(?:03|22)\b|error\s*:?\s*40[014]\b|error\s*:?\s*4(?:03|22)\b/i;

/** Check whether an error is a deterministic client error (see above). */
export function isDeterministicError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return DETERMINISTIC_ERROR_RE.test(message);
}

/**
 * Cooldown-worthy errors: transient (retry the same model later) or
 * deterministic (try a fallback now, cool the broken model). The consolidation
 * pipeline records cooldown for both; `isRetryableError` alone only covers
 * the transient half (429/5xx/timeout), which is why deterministic 4xx like
 * `MissingSessionID` previously retried the same broken model indefinitely.
 */
export function isCooldownWorthyError(error: unknown): boolean {
  return isRetryableError(error) || isDeterministicError(error);
}

/** Detect Pi's "extension ctx is stale" error from session replacement/reload.
 *  These are not model errors and must not be recorded as cooldowns. */
export function isStaleExtensionContextError(error: unknown): boolean {
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (error && typeof error === "object" && "message" in error) {
    message = String((error as { message: unknown }).message);
  } else {
    message = String(error || "");
  }
  return message.includes("extension ctx is stale") || message.includes("ctx is stale");
}
