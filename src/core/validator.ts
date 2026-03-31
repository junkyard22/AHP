import {
  ALL_MESSAGE_TYPES,
  MailmanMessage,
  REPLY_LIKE_MESSAGE_TYPES,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../packet/types";
import { normalizeMessage } from "../packet/createPacket";
import { MailmanError, ErrorCode } from "./errors";
import { Registry } from "./registry";

// ─────────────────────────────────────────────
//  Validation result
// ─────────────────────────────────────────────

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

// ─────────────────────────────────────────────
//  Validator
// ─────────────────────────────────────────────

export class Validator {
  constructor(private readonly registry: Registry) {}

  validate(packet: MailmanMessage): ValidationResult {
    const message = normalizeMessage(packet);

    // Required string fields
    const requiredStrings = [
      { field: "messageId", value: message.messageId },
      { field: "conversationId", value: message.conversationId },
      { field: "type", value: message.type },
      { field: "sender", value: message.sender },
      { field: "target", value: message.target },
      { field: "protocol", value: message.protocol },
    ];

    for (const field of requiredStrings) {
      const value = field.value;
      if (value === undefined || value === null || value === "") {
        return {
          ok: false,
          code: ErrorCode.INVALID_PACKET,
          message: `Missing required field: ${field.field}`,
        };
      }
    }

    // payload must exist (can be an empty object)
    if (message.payload === undefined || message.payload === null) {
      return {
        ok: false,
        code: ErrorCode.INVALID_PACKET,
        message: "Missing required field: payload",
      };
    }

    // type must be known
    if (!ALL_MESSAGE_TYPES.includes(message.type)) {
      return {
        ok: false,
        code: ErrorCode.INVALID_PACKET,
        message: `Unknown message type: ${message.type}`,
      };
    }

    // confidence must be 0–1 if present
    if (message.confidence !== undefined) {
      if (
        typeof message.confidence !== "number" ||
        message.confidence < 0 ||
        message.confidence > 1
      ) {
        return {
          ok: false,
          code: ErrorCode.INVALID_PACKET,
          message: `confidence must be a number between 0 and 1 (got ${message.confidence})`,
        };
      }
    }

    const target = this.registry.get(message.target);
    if (!target) {
      return {
        ok: false,
        code: ErrorCode.UNKNOWN_TARGET,
        message: `Target agent not registered: ${message.target}`,
      };
    }

    if (!target.registration.accepts.includes(message.type)) {
      return {
        ok: false,
        code: ErrorCode.TARGET_REJECTS_TYPE,
        message: `Target "${message.target}" does not accept type "${message.type}"`,
      };
    }

    const supportedProtocols = target.registration.protocols ?? [
      ...SUPPORTED_PROTOCOL_VERSIONS,
    ];
    if (!supportedProtocols.includes(message.protocol)) {
      return {
        ok: false,
        code: ErrorCode.TARGET_REJECTS_PROTOCOL,
        message: `Target "${message.target}" does not support protocol "${message.protocol}"`,
      };
    }

    if (
      REPLY_LIKE_MESSAGE_TYPES.includes(message.type) &&
      !message.replyTo &&
      !message.parentPacketId
    ) {
      return {
        ok: false,
        code: ErrorCode.INVALID_REPLY,
        message: `Reply-like message type "${message.type}" requires replyTo`,
      };
    }

    return { ok: true };
  }
}

/**
 * Convenience assertion — throws MailmanError on failure.
 */
export function assertValid(
  packet: MailmanMessage,
  registry: Registry
): void {
  const result = new Validator(registry).validate(packet);
  if (!result.ok) {
    throw new MailmanError(result.code, result.message);
  }
}
