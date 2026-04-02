// ─────────────────────────────────────────────
//  Structured error types for Mailman internals
// ─────────────────────────────────────────────

export class MailmanError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "MailmanError";
    this.code = code;
    this.details = details;
  }
}

// ─────────────────────────────────────────────
//  Known error codes
// ─────────────────────────────────────────────

export const ErrorCode = {
  INVALID_PACKET:          "INVALID_PACKET",
  UNKNOWN_TARGET:          "UNKNOWN_TARGET",
  TARGET_REJECTS_TYPE:     "TARGET_REJECTS_TYPE",
  HANDLER_THREW:           "HANDLER_THREW",
  HANDLER_TIMEOUT:         "HANDLER_TIMEOUT",
  ROLE_ALREADY_REGISTERED: "ROLE_ALREADY_REGISTERED",
  ROLE_NOT_FOUND:          "ROLE_NOT_FOUND",
  RUNTIME_NOT_STARTED:     "RUNTIME_NOT_STARTED",
  /** sendToCapability() found no registered role with the requested capability */
  NO_CAPABLE_ROLE:         "NO_CAPABLE_ROLE",
  /** openStream() or stream.chunk received for an unknown streamId */
  STREAM_NOT_FOUND:        "STREAM_NOT_FOUND",
  /** cancelScheduled() called with an unknown scheduleId */
  SCHEDULE_NOT_FOUND:      "SCHEDULE_NOT_FOUND",
  /** HTTP server rejected request due to missing or invalid API key */
  AUTH_FAILED:             "AUTH_FAILED",
} as const;

export type ErrorCodeKey = keyof typeof ErrorCode;
