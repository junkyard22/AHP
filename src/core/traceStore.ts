import { MailmanTraceEntry, MailmanTraceEvent } from "../packet/types";
import { newId } from "../utils/ids";
import { now } from "../utils/time";

// ─────────────────────────────────────────────
//  In-memory trace store (SQLite later)
// ─────────────────────────────────────────────

export class TraceStore {
  /** Primary index: traceId → entry */
  private readonly entries = new Map<string, MailmanTraceEntry>();

  /** Secondary index: packetId → traceId list */
  private readonly byPacket = new Map<string, string[]>();

  /** Secondary index: taskId → traceId list */
  private readonly byTask = new Map<string, string[]>();

  // ── Write ──────────────────────────────────

  record(
    packetId: string,
    taskId: string,
    event: MailmanTraceEvent,
    actor: string,
    details?: Record<string, unknown>
  ): MailmanTraceEntry {
    const entry: MailmanTraceEntry = {
      traceId: newId("trace"),
      packetId,
      taskId,
      event,
      actor,
      timestamp: now(),
      details,
    };

    this.entries.set(entry.traceId, entry);

    if (!this.byPacket.has(packetId)) this.byPacket.set(packetId, []);
    this.byPacket.get(packetId)!.push(entry.traceId);

    if (!this.byTask.has(taskId)) this.byTask.set(taskId, []);
    this.byTask.get(taskId)!.push(entry.traceId);

    return entry;
  }

  // ── Read ───────────────────────────────────

  getByPacket(packetId: string): MailmanTraceEntry[] {
    const ids = this.byPacket.get(packetId) ?? [];
    return ids.map((id) => this.entries.get(id)!).filter(Boolean);
  }

  getByTask(taskId: string): MailmanTraceEntry[] {
    const ids = this.byTask.get(taskId) ?? [];
    return ids.map((id) => this.entries.get(id)!).filter(Boolean);
  }

  all(): MailmanTraceEntry[] {
    return Array.from(this.entries.values());
  }

  totalEvents(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.byPacket.clear();
    this.byTask.clear();
  }
}
