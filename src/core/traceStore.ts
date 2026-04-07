import type { DatabaseSync } from "node:sqlite";
import { MailmanTraceEntry, MailmanTraceEvent } from "../packet/types";
import { newId } from "../utils/ids";
import { now } from "../utils/time";
import { openDb } from "./db";

// ─────────────────────────────────────────────
//  Query filters for Postmaster / CLI use
// ─────────────────────────────────────────────

export interface TraceQuery {
  /** ISO timestamp lower bound */
  since?: string;
  /** ISO timestamp upper bound */
  until?: string;
  /** Filter by actor name */
  actor?: string;
  /** Filter by event type */
  event?: string;
  /** Max rows returned (default: 100) */
  limit?: number;
}

// ─────────────────────────────────────────────
//  TraceStore — SQLite-backed, persistent
// ─────────────────────────────────────────────

export class TraceStore {
  private readonly db: DatabaseSync;

  /**
   * @param dbPath SQLite file path. Defaults to ~/.mailman/traces.db.
   *               Pass ':memory:' for ephemeral/test usage.
   */
  constructor(dbPath?: string) {
    this.db = openDb(dbPath);
  }

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

    this.db
      .prepare(
        `INSERT INTO trace_events
         (trace_id, packet_id, task_id, event, actor, timestamp, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.traceId,
        packetId,
        taskId,
        event,
        actor,
        entry.timestamp,
        details !== undefined ? JSON.stringify(details) : null
      );

    return entry;
  }

  // ── Read ───────────────────────────────────

  getByPacket(packetId: string): MailmanTraceEntry[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM trace_events WHERE packet_id = ? ORDER BY timestamp ASC"
        )
        .all(packetId) as Record<string, unknown>[]
    ).map(rowToEntry);
  }

  getByTask(taskId: string): MailmanTraceEntry[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM trace_events WHERE task_id = ? ORDER BY timestamp ASC"
        )
        .all(taskId) as Record<string, unknown>[]
    ).map(rowToEntry);
  }

  all(): MailmanTraceEntry[] {
    return (
      this.db
        .prepare("SELECT * FROM trace_events ORDER BY timestamp ASC")
        .all() as Record<string, unknown>[]
    ).map(rowToEntry);
  }

  totalEvents(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM trace_events")
      .get() as { count: number };
    return row.count;
  }

  // ── Query (for Postmaster / CLI) ───────────

  /**
   * Flexible filter query — used by Postmaster and `mailman inspect`.
   */
  query({
    since,
    until,
    actor,
    event,
    limit = 100,
  }: TraceQuery): MailmanTraceEntry[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (since) {
      conditions.push("timestamp >= ?");
      params.push(since);
    }
    if (until) {
      conditions.push("timestamp <= ?");
      params.push(until);
    }
    if (actor) {
      conditions.push("actor = ?");
      params.push(actor);
    }
    if (event) {
      conditions.push("event = ?");
      params.push(event);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM trace_events ${where} ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    return (
      this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    ).map(rowToEntry);
  }

  // ── Maintenance ────────────────────────────

  clear(): void {
    this.db.exec("DELETE FROM trace_events");
  }
}

// ─────────────────────────────────────────────
//  Row → domain type
// ─────────────────────────────────────────────

function rowToEntry(row: Record<string, unknown>): MailmanTraceEntry {
  return {
    traceId: row["trace_id"] as string,
    packetId: row["packet_id"] as string,
    taskId: row["task_id"] as string,
    event: row["event"] as MailmanTraceEvent,
    actor: row["actor"] as string,
    timestamp: row["timestamp"] as string,
    details:
      typeof row["details"] === "string"
        ? (JSON.parse(row["details"]) as Record<string, unknown>)
        : undefined,
  };
}
