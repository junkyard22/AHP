/**
 * Return the current time as an ISO 8601 string.
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Return the number of milliseconds elapsed since a prior ISO timestamp.
 */
export function elapsedMs(since: string): number {
  return Date.now() - new Date(since).getTime();
}
