import { MailmanPacket } from "../packet/types";
import { newId } from "../utils/ids";
import { now } from "../utils/time";

// ─────────────────────────────────────────────
//  Scheduled packet entry
// ─────────────────────────────────────────────

export interface ScheduledEntry {
  scheduleId: string;
  packet: MailmanPacket;
  /** Unix epoch ms of next delivery */
  deliverAt: number;
  /** Present when the schedule repeats */
  recurring?: { intervalMs: number };
  createdAt: string;
}

type DispatchFn = (packet: MailmanPacket) => void;

// ─────────────────────────────────────────────
//  PacketScheduler
//
//  In-memory scheduler backed by setTimeout.
//  Schedules survive cancel() calls but NOT
//  process restarts — for persistence, pair
//  with the scheduled_packets SQLite table.
// ─────────────────────────────────────────────

export class PacketScheduler {
  private readonly pending = new Map<
    string,
    { entry: ScheduledEntry; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(private readonly dispatch: DispatchFn) {}

  /**
   * Deliver packet once at the given date.
   * Returns the scheduleId.
   */
  schedule(packet: MailmanPacket, deliverAt: Date): string {
    const entry: ScheduledEntry = {
      scheduleId: newId("sched"),
      packet,
      deliverAt: deliverAt.getTime(),
      createdAt: now(),
    };
    this.arm(entry, Math.max(0, deliverAt.getTime() - Date.now()));
    return entry.scheduleId;
  }

  /**
   * Deliver packet once after delayMs milliseconds.
   * Returns the scheduleId.
   */
  scheduleAfter(packet: MailmanPacket, delayMs: number): string {
    return this.schedule(packet, new Date(Date.now() + delayMs));
  }

  /**
   * Deliver packet repeatedly every intervalMs milliseconds.
   * First delivery is after intervalMs (or at startAt if provided).
   * Returns the scheduleId — pass to cancel() to stop.
   */
  scheduleRecurring(
    packet: MailmanPacket,
    intervalMs: number,
    startAt?: Date
  ): string {
    const first = startAt ?? new Date(Date.now() + intervalMs);
    const entry: ScheduledEntry = {
      scheduleId: newId("sched"),
      packet,
      deliverAt: first.getTime(),
      recurring: { intervalMs },
      createdAt: now(),
    };
    this.arm(entry, Math.max(0, first.getTime() - Date.now()));
    return entry.scheduleId;
  }

  /**
   * Cancel a pending schedule.
   * Returns true if found and cancelled, false if not found.
   */
  cancel(scheduleId: string): boolean {
    const item = this.pending.get(scheduleId);
    if (!item) return false;
    clearTimeout(item.timer);
    this.pending.delete(scheduleId);
    return true;
  }

  /** All schedules currently waiting to fire. */
  listPending(): ScheduledEntry[] {
    return Array.from(this.pending.values()).map((v) => v.entry);
  }

  // ── Internal ──────────────────────────────

  private arm(entry: ScheduledEntry, delayMs: number): void {
    const timer = setTimeout(() => {
      this.pending.delete(entry.scheduleId);
      this.dispatch(entry.packet);

      if (entry.recurring) {
        const next: ScheduledEntry = {
          ...entry,
          deliverAt: Date.now() + entry.recurring.intervalMs,
        };
        this.arm(next, entry.recurring.intervalMs);
      }
    }, delayMs);

    // Prevent long-running timers from keeping the process alive
    if (typeof timer === "object" && "unref" in timer) {
      (timer as NodeJS.Timeout).unref();
    }

    this.pending.set(entry.scheduleId, { entry, timer });
  }
}
