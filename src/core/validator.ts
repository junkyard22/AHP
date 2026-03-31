import { MailmanPacket, ALL_PACKET_TYPES } from "../packet/types";
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

  validate(packet: MailmanPacket): ValidationResult {
    // Required string fields
    const requiredStrings: (keyof MailmanPacket)[] = [
      "packetId",
      "taskId",
      "type",
      "sender",
      "target",
    ];

    for (const field of requiredStrings) {
      const value = packet[field];
      if (value === undefined || value === null || value === "") {
        return {
          ok: false,
          code: ErrorCode.INVALID_PACKET,
          message: `Missing required field: ${field}`,
        };
      }
    }

    // payload must exist (can be empty object)
    if (packet.payload === undefined || packet.payload === null) {
      return {
        ok: false,
        code: ErrorCode.INVALID_PACKET,
        message: "Missing required field: payload",
      };
    }

    // type must be a known PacketType
    if (!ALL_PACKET_TYPES.includes(packet.type)) {
      return {
        ok: false,
        code: ErrorCode.INVALID_PACKET,
        message: `Unknown packet type: ${packet.type}`,
      };
    }

    // confidence must be 0–1 if present
    if (packet.confidence !== undefined) {
      if (
        typeof packet.confidence !== "number" ||
        packet.confidence < 0 ||
        packet.confidence > 1
      ) {
        return {
          ok: false,
          code: ErrorCode.INVALID_PACKET,
          message: `confidence must be a number between 0 and 1 (got ${packet.confidence})`,
        };
      }
    }

    // target must be registered
    const role = this.registry.get(packet.target);
    if (!role) {
      return {
        ok: false,
        code: ErrorCode.UNKNOWN_TARGET,
        message: `Target not registered: ${packet.target}`,
      };
    }

    // type must be accepted by target
    if (!role.registration.accepts.includes(packet.type)) {
      return {
        ok: false,
        code: ErrorCode.TARGET_REJECTS_TYPE,
        message: `Target "${packet.target}" does not accept type "${packet.type}"`,
      };
    }

    return { ok: true };
  }
}

/**
 * Convenience assertion — throws MailmanError on failure.
 */
export function assertValid(
  packet: MailmanPacket,
  registry: Registry
): void {
  const result = new Validator(registry).validate(packet);
  if (!result.ok) {
    throw new MailmanError(result.code, result.message);
  }
}
