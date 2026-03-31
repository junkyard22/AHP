import { MailmanTraceEntry, MailmanTraceEvent } from "../packet/types";
import { newId } from "../utils/ids";
import { now } from "../utils/time";

// ─────────────────────────────────────────────
//  In-memory trace store (SQLite later)
// ─────────────────────────────────────────────

export class TraceStore {
  /** Primary index: traceId → entry */
  private readonly entries = new Map<string, MailmanTraceEntry>();

  /** Secondary index: messageId → traceId list */
  private readonly byMessage = new Map<string, string[]>();

  /** Secondary index: conversationId → traceId list */
  private readonly byConversation = new Map<string, string[]>();

  // ── Write ──────────────────────────────────

  record(
    messageId: string,
    conversationId: string,
    event: MailmanTraceEvent,
    actor: string,
    details?: Record<string, unknown>
  ): MailmanTraceEntry {
    const entry: MailmanTraceEntry = {
      traceId: newId("trace"),
      messageId,
      packetId: messageId,
      conversationId,
      taskId: conversationId,
      event,
      actor,
      timestamp: now(),
      details,
    };

    this.entries.set(entry.traceId, entry);

    if (!this.byMessage.has(messageId)) this.byMessage.set(messageId, []);
    this.byMessage.get(messageId)!.push(entry.traceId);

    if (!this.byConversation.has(conversationId)) {
      this.byConversation.set(conversationId, []);
    }
    this.byConversation.get(conversationId)!.push(entry.traceId);

    return entry;
  }

  // ── Read ───────────────────────────────────

  getByMessage(messageId: string): MailmanTraceEntry[] {
    const ids = this.byMessage.get(messageId) ?? [];
    return ids.map((id) => this.entries.get(id)!).filter(Boolean);
  }

  getByPacket(packetId: string): MailmanTraceEntry[] {
    return this.getByMessage(packetId);
  }

  getByConversation(conversationId: string): MailmanTraceEntry[] {
    const ids = this.byConversation.get(conversationId) ?? [];
    return ids.map((id) => this.entries.get(id)!).filter(Boolean);
  }

  getByTask(taskId: string): MailmanTraceEntry[] {
    return this.getByConversation(taskId);
  }

  all(): MailmanTraceEntry[] {
    return Array.from(this.entries.values());
  }

  totalEvents(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.byMessage.clear();
    this.byConversation.clear();
  }
}
