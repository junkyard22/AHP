import { PostmasterObservation } from "../packet/types";
import { newId } from "../utils/ids";
import { now } from "../utils/time";

type ObservationInit = Omit<
  PostmasterObservation,
  "observationId" | "timestamp"
> &
  Partial<Pick<PostmasterObservation, "observationId" | "timestamp">>;

// ─────────────────────────────────────────────
//  In-memory observation store (SQLite later)
// ─────────────────────────────────────────────

export class ObservationStore {
  /** Primary index: observationId → entry */
  private readonly entries = new Map<string, PostmasterObservation>();

  /** Secondary index: messageId → observationId list */
  private readonly byMessage = new Map<string, string[]>();

  /** Secondary index: conversationId → observationId list */
  private readonly byConversation = new Map<string, string[]>();

  record(init: ObservationInit): PostmasterObservation {
    const entry: PostmasterObservation = {
      ...init,
      observationId: init.observationId ?? newId("obs"),
      timestamp: init.timestamp ?? now(),
    };

    this.entries.set(entry.observationId, entry);

    if (!this.byMessage.has(entry.messageId)) this.byMessage.set(entry.messageId, []);
    this.byMessage.get(entry.messageId)!.push(entry.observationId);

    if (!this.byConversation.has(entry.conversationId)) {
      this.byConversation.set(entry.conversationId, []);
    }
    this.byConversation.get(entry.conversationId)!.push(entry.observationId);

    return entry;
  }

  getByMessage(messageId: string): PostmasterObservation[] {
    const ids = this.byMessage.get(messageId) ?? [];
    return ids.map((id) => this.entries.get(id)!).filter(Boolean);
  }

  getByConversation(conversationId: string): PostmasterObservation[] {
    const ids = this.byConversation.get(conversationId) ?? [];
    return ids.map((id) => this.entries.get(id)!).filter(Boolean);
  }

  all(): PostmasterObservation[] {
    return Array.from(this.entries.values());
  }

  totalObservations(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.byMessage.clear();
    this.byConversation.clear();
  }
}
