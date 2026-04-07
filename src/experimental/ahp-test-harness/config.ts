import { AHPTestTimeouts } from "./types";

export const AHP_TEST_MODE_ENV = "AHP_TEST_MODE";

export const DEFAULT_AHP_TEST_TIMEOUTS: AHPTestTimeouts = {
  handshakeTimeoutMs: 5_000,
  taskAckTimeoutMs: 3_000,
  inactivityTimeoutMs: 60_000,
  maxIdempotentRetries: 2,
};

export function isAHPTestModeEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = env[AHP_TEST_MODE_ENV];
  if (!raw) return false;

  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}
