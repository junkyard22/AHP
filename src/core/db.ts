// node:sqlite is built into Node.js 22+
// No external dependency — no native binary issues in any environment
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
const { DatabaseSync } = require("node:sqlite");
import path from "path";
import os from "os";
import fs from "fs";

// ─────────────────────────────────────────────
//  Default DB path — user home directory so
//  traces persist across projects and restarts.
//  Postmaster reads from here.
// ─────────────────────────────────────────────

export const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  ".mailman",
  "traces.db"
);

// ─────────────────────────────────────────────
//  Open (or create) the SQLite database.
//  Pass ':memory:' for ephemeral / test usage.
// ─────────────────────────────────────────────

export function openDb(dbPath: string = DEFAULT_DB_PATH): DatabaseSyncType {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // WAL mode — better concurrent read performance
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Idempotent schema migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_events (
      trace_id  TEXT PRIMARY KEY,
      packet_id TEXT NOT NULL,
      task_id   TEXT NOT NULL,
      event     TEXT NOT NULL,
      actor     TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_trace_packet    ON trace_events(packet_id);
    CREATE INDEX IF NOT EXISTS idx_trace_task      ON trace_events(task_id);
    CREATE INDEX IF NOT EXISTS idx_trace_timestamp ON trace_events(timestamp);

    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id         TEXT PRIMARY KEY,
      packet     TEXT    NOT NULL,
      error      TEXT    NOT NULL,
      attempts   INTEGER NOT NULL,
      first_seen TEXT    NOT NULL,
      last_seen  TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dlq_last_seen ON dead_letter_queue(last_seen);
  `);

  return db;
}
