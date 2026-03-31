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
  INVALID_PACKET: "INVALID_PACKET",
  UNKNOWN_TARGET: "UNKNOWN_TARGET",
  TARGET_REJECTS_TYPE: "TARGET_REJECTS_TYPE",
  TARGET_REJECTS_PROTOCOL: "TARGET_REJECTS_PROTOCOL",
  INVALID_REPLY: "INVALID_REPLY",
  HANDLER_THREW: "HANDLER_THREW",
  HANDLER_TIMEOUT: "HANDLER_TIMEOUT",
  ROLE_ALREADY_REGISTERED: "ROLE_ALREADY_REGISTERED",
  ROLE_NOT_FOUND: "ROLE_NOT_FOUND",
  OBSERVER_ALREADY_REGISTERED: "OBSERVER_ALREADY_REGISTERED",
  OBSERVER_NOT_FOUND: "OBSERVER_NOT_FOUND",
  RUNTIME_NOT_STARTED: "RUNTIME_NOT_STARTED",
} as const;

export type ErrorCodeKey = keyof typeof ErrorCode;

export { MailmanError as PostmasterError };
