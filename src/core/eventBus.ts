import { MailmanPacket } from "../packet/types";

// ─────────────────────────────────────────────
//  EventBus — pub/sub for Mailman packets
//
//  Topics support exact match and wildcard suffix:
//    "task.result"  — exact type match
//    "task.*"       — all task.* types
//    "*"            — every packet
// ─────────────────────────────────────────────

export type TopicHandler = (packet: MailmanPacket) => void;

export class EventBus {
  private readonly subs = new Map<string, Set<TopicHandler>>();

  /**
   * Subscribe to a topic pattern.
   * Returns an unsubscribe function.
   *
   * @example
   * const unsub = bus.subscribe("task.*", (pkt) => console.log(pkt));
   * // later:
   * unsub();
   */
  subscribe(topic: string, handler: TopicHandler): () => void {
    if (!this.subs.has(topic)) {
      this.subs.set(topic, new Set());
    }
    this.subs.get(topic)!.add(handler);
    return () => this.unsubscribe(topic, handler);
  }

  private unsubscribe(topic: string, handler: TopicHandler): void {
    const set = this.subs.get(topic);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.subs.delete(topic);
  }

  /**
   * Deliver a packet to all matching subscribers.
   * Exceptions thrown by subscribers are swallowed — the bus never crashes.
   */
  publish(packet: MailmanPacket): void {
    for (const [topic, handlers] of this.subs) {
      if (this.matches(topic, packet.type)) {
        for (const handler of handlers) {
          try {
            handler(packet);
          } catch {
            // intentional: pub/sub is fire-and-forget
          }
        }
      }
    }
  }

  /** Total number of active subscriptions across all topics. */
  subscriberCount(topic?: string): number {
    if (topic !== undefined) return this.subs.get(topic)?.size ?? 0;
    let total = 0;
    for (const set of this.subs.values()) total += set.size;
    return total;
  }

  // ── Topic matching ────────────────────────

  private matches(topic: string, packetType: string): boolean {
    if (topic === "*") return true;
    if (topic === packetType) return true;
    // "task.*"  → matches "task.assign", "task.result", etc.
    // "stream.*" → matches "stream.open", "stream.chunk", etc.
    if (topic.endsWith(".*")) {
      const prefix = topic.slice(0, -2);
      return packetType === prefix || packetType.startsWith(prefix + ".");
    }
    return false;
  }
}
