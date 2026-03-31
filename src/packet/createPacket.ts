import { MailmanPacket, PacketType } from "./types";
import { newPacketId } from "../utils/ids";
import { now } from "../utils/time";

// ─────────────────────────────────────────────
//  Factory helpers
// ─────────────────────────────────────────────

type PacketInit = Omit<MailmanPacket, "packetId" | "timestamp"> &
  Partial<Pick<MailmanPacket, "packetId" | "timestamp">>;

/**
 * Create a MailmanPacket, filling in packetId and timestamp if not provided.
 */
export function createPacket(init: PacketInit): MailmanPacket {
  return {
    ...init,
    packetId: init.packetId ?? newPacketId(),
    timestamp: init.timestamp ?? now(),
  };
}

/**
 * Build a typed reply packet from a prior received packet.
 */
export function createReply(
  original: MailmanPacket,
  type: PacketType,
  sender: string,
  payload: Record<string, unknown>,
  overrides?: Partial<MailmanPacket>
): MailmanPacket {
  return createPacket({
    packetId: newPacketId(),
    taskId: original.taskId,
    parentPacketId: original.packetId,
    type,
    sender,
    target: original.sender,
    timestamp: now(),
    payload,
    ...overrides,
  });
}
