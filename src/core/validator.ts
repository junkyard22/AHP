import { MailmanPacket, BUILTIN_PACKET_TYPES } from "../packet/types";
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
  /**
   * @param registry   Role registry — used to verify target exists and accepts the type.
   * @param customTypes Extra packet types registered by the user via runtime.registerPacketType().
   */
  constructor(
    private readonly registry: Registry,
    private readonly customTypes: Set<string> = new Set()
  ) {}

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

    // type must be a known built-in OR a user-registered custom type
    const isBuiltin = (BUILTIN_PACKET_TYPES as string[]).includes(packet.type);
    const isCustom  = this.customTypes.has(packet.type);

    if (!isBuiltin && !isCustom) {
      return {
        ok: false,
        code: ErrorCode.INVALID_PACKET,
        message: `Unknown packet type: "${packet.type}". Register custom types with runtime.registerPacketType()`,
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
  registry: Registry,
  customTypes?: Set<string>
): void {
  const result = new Validator(registry, customTypes).validate(packet);
  if (!result.ok) {
    throw new MailmanError(result.code, result.message);
  }
}
