import type { DatabaseSync } from "node:sqlite";
import { MailmanPacket } from "../packet/types";
import { newId } from "../utils/ids";
import { now } from "../utils/time";
import { openDb } from "./db";

// ─────────────────────────────────────────────
//  DLQ entry shape
// ─────────────────────────────────────────────

export interface DLQEntry {
  id: string;
  packet: MailmanPacket;
  error: string;
  attempts: number;
  firstSeen: string;
  lastSeen: string;
}

// ─────────────────────────────────────────────
//  DeadLetterQueue — SQLite-backed
//
//  Lives in the same DB as TraceStore so
//  Postmaster can see both in one file.
// ─────────────────────────────────────────────

export class DeadLetterQueue {
  private readonly db: DatabaseSync;

  /**
   * @param dbPath SQLite file path. Defaults to ~/.mailman/traces.db.
   *               Pass ':memory:' for tests.
   */
  constructor(dbPath?: string) {
    this.db = openDb(dbPath);
  }

  // ── Write ──────────────────────────────────

  push(
    packet: MailmanPacket,
    error: string,
    attempts: number
  ): DLQEntry {
    const id = newId("dlq");
    const ts = now();

    this.db
      .prepare(
        `INSERT INTO dead_letter_queue
         (id, packet, error, attempts, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, JSON.stringify(packet), error, attempts, ts, ts);

    return { id, packet, error, attempts, firstSeen: ts, lastSeen: ts };
  }

  // ── Read ───────────────────────────────────

  list(): DLQEntry[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM dead_letter_queue ORDER BY last_seen DESC"
        )
        .all() as Record<string, unknown>[]
    ).map(rowToEntry);
  }

  get(id: string): DLQEntry | undefined {
    const row = this.db
      .prepare("SELECT * FROM dead_letter_queue WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToEntry(row) : undefined;
  }

  count(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as n FROM dead_letter_queue")
      .get() as { n: number };
    return row.n;
  }

  // ── Remove ─────────────────────────────────

  remove(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM dead_letter_queue WHERE id = ?")
      .run(id);
    return (result as { changes: number }).changes > 0;
  }

  clear(): void {
    this.db.exec("DELETE FROM dead_letter_queue");
  }
}

// ─────────────────────────────────────────────
//  Row → domain type
// ─────────────────────────────────────────────

function rowToEntry(row: Record<string, unknown>): DLQEntry {
  return {
    id: row["id"] as string,
    packet: JSON.parse(row["packet"] as string) as MailmanPacket,
    error: row["error"] as string,
    attempts: row["attempts"] as number,
    firstSeen: row["first_seen"] as string,
    lastSeen: row["last_seen"] as string,
  };
}
