import { v4 as uuidv4 } from "uuid";

/**
 * Generate a new unique packet ID.
 * Format: pkt_<uuid-short>
 */
export function newPacketId(): string {
  return `pkt_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Generate a new unique task ID.
 * Format: task_<uuid-short>
 */
export function newTaskId(): string {
  return `task_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Generate a generic unique ID with an optional prefix.
 */
export function newId(prefix = "id"): string {
  return `${prefix}_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
}
