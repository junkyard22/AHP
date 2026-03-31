import { v4 as uuidv4 } from "uuid";

/**
 * Generate a new unique packet ID.
 * Format: pkt_<uuid-short>
 */
export function newPacketId(): string {
  return `pkt_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Generate a new unique message ID.
 * Uses the legacy packet ID format for wire compatibility.
 */
export function newMessageId(): string {
  return newPacketId();
}

/**
 * Generate a new unique task ID.
 * Format: task_<uuid-short>
 */
export function newTaskId(): string {
  return `task_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Generate a new unique conversation ID.
 * Uses the legacy task ID format for trace compatibility.
 */
export function newConversationId(): string {
  return newTaskId();
}

/**
 * Generate a generic unique ID with an optional prefix.
 */
export function newId(prefix = "id"): string {
  return `${prefix}_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
}
