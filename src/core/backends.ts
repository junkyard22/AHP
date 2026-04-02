import { MailmanPacket, MailmanTraceEntry, MailmanTraceEvent } from "../packet/types";
import { DLQEntry } from "./dlq";
import { TraceQuery } from "./traceStore";
import { newId } from "../utils/ids";
import { now } from "../utils/time";

// ─────────────────────────────────────────────
//  ITraceStore — pluggable trace backend
//
//  The default SQLite-backed TraceStore implements
//  this interface. Implement it yourself to route
//  traces to Redis, Postgres, OpenTelemetry, etc.
// ─────────────────────────────────────────────

export interface ITraceStore {
  record(
    packetId: string,
    taskId: string,
    event: MailmanTraceEvent,
    actor: string,
    details?: Record<string, unknown>
  ): void;

  getByPacket(packetId: string): MailmanTraceEntry[];
  getByTask(taskId: string): MailmanTraceEntry[];
  all(): MailmanTraceEntry[];
  totalEvents(): number;
  query(q: TraceQuery): MailmanTraceEntry[];
}

// ─────────────────────────────────────────────
//  IDLQStore — pluggable dead-letter queue backend
// ─────────────────────────────────────────────

export interface IDLQStore {
  push(packet: MailmanPacket, error: string, attempts: number): void;
  list(): DLQEntry[];
  get(dlqId: string): DLQEntry | undefined;
  count(): number;
  /** Returns true if the entry was found and removed. */
  remove(dlqId: string): boolean;
  clear(): void;
}

// ─────────────────────────────────────────────
//  MemoryTraceStore
//
//  Zero-dependency in-memory implementation.
//  Ideal for tests or short-lived processes.
// ─────────────────────────────────────────────

export class MemoryTraceStore implements ITraceStore {
  private readonly entries: MailmanTraceEntry[] = [];

  record(
    packetId: string,
    taskId: string,
    event: MailmanTraceEvent,
    actor: string,
    details?: Record<string, unknown>
  ): void {
    this.entries.push({
      traceId: newId("trace"),
      packetId,
      taskId,
      event,
      actor,
      timestamp: now(),
      details,
    });
  }

  getByPacket(packetId: string): MailmanTraceEntry[] {
    return this.entries.filter((e) => e.packetId === packetId);
  }

  getByTask(taskId: string): MailmanTraceEntry[] {
    return this.entries.filter((e) => e.taskId === taskId);
  }

  all(): MailmanTraceEntry[] {
    return [...this.entries];
  }

  totalEvents(): number {
    return this.entries.length;
  }

  query({ packetId, taskId, event, actor, since, until, limit = 100 }: TraceQuery & { packetId?: string; taskId?: string }): MailmanTraceEntry[] {
    let results = this.entries;
    if (packetId) results = results.filter((e) => e.packetId === packetId);
    if (taskId)   results = results.filter((e) => e.taskId   === taskId);
    if (event)    results = results.filter((e) => e.event    === event);
    if (actor)    results = results.filter((e) => e.actor    === actor);
    if (since)    results = results.filter((e) => e.timestamp >= since);
    if (until)    results = results.filter((e) => e.timestamp <= until);
    return results.slice(-limit);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

// ─────────────────────────────────────────────
//  MemoryDLQStore
// ─────────────────────────────────────────────

export class MemoryDLQStore implements IDLQStore {
  private readonly entries = new Map<string, DLQEntry>();

  push(packet: MailmanPacket, error: string, attempts: number): void {
    // If the packet is already in the DLQ update it in-place
    for (const entry of this.entries.values()) {
      if (entry.packet.packetId === packet.packetId) {
        entry.error    = error;
        entry.attempts = attempts;
        entry.lastSeen = now();
        return;
      }
    }
    const id = newId("dlq");
    const ts = now();
    this.entries.set(id, { id, packet, error, attempts, firstSeen: ts, lastSeen: ts });
  }

  list(): DLQEntry[] {
    return Array.from(this.entries.values());
  }

  get(dlqId: string): DLQEntry | undefined {
    return this.entries.get(dlqId);
  }

  count(): number {
    return this.entries.size;
  }

  remove(dlqId: string): boolean {
    return this.entries.delete(dlqId);
  }

  clear(): void {
    this.entries.clear();
  }
}
