// ─────────────────────────────────────────────
//  Retry policy + exponential backoff helper
// ─────────────────────────────────────────────

export interface RetryPolicy {
  /** Max total attempts (including the first). Default: 3 */
  maxAttempts: number;
  /** Base delay in ms for the first retry. Default: 250 */
  baseDelayMs: number;
  /** Hard cap on computed delay. Default: 5000 */
  maxDelayMs: number;
  /** Backoff strategy. Default: 'exponential' */
  backoff: "exponential" | "fixed";
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 5000,
  backoff: "exponential",
};

// ─────────────────────────────────────────────
//  Compute delay for attempt N (0-indexed)
// ─────────────────────────────────────────────

function computeDelay(attempt: number, policy: RetryPolicy): number {
  if (policy.backoff === "fixed") return policy.baseDelayMs;

  // Exponential with ±30% jitter to spread thundering herds
  const exp = Math.min(
    policy.baseDelayMs * Math.pow(2, attempt),
    policy.maxDelayMs
  );
  const jitter = Math.random() * 0.3 * exp;
  return Math.floor(exp + jitter);
}

// ─────────────────────────────────────────────
//  withRetry — wraps any async fn with retry logic
// ─────────────────────────────────────────────

export type RetrySuccess<T> = { ok: true; result: T; attempts: number };
export type RetryFailure = { ok: false; error: Error; attempts: number };
export type RetryOutcome<T> = RetrySuccess<T> | RetryFailure;

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): Promise<RetryOutcome<T>> {
  let lastError: Error = new Error("Unknown error");

  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      const result = await fn();
      return { ok: true, result, attempts: attempt + 1 };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't sleep after the last attempt
      if (attempt < policy.maxAttempts - 1) {
        const delay = computeDelay(attempt, policy);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return { ok: false, error: lastError, attempts: policy.maxAttempts };
}
