import { Command } from "commander";
import { DeadLetterQueue } from "../../core/dlq";
import { DEFAULT_DB_PATH } from "../../core/db";

export function registerDlqCommand(program: Command): void {
  const dlq = program
    .command("dlq")
    .description("Inspect and manage the Dead Letter Queue");

  // ── list ───────────────────────────────────
  dlq
    .command("list")
    .description("List all packets in the Dead Letter Queue")
    .option("--db <path>", "Path to mailman.db", DEFAULT_DB_PATH)
    .action((opts: { db: string }) => {
      const queue = new DeadLetterQueue(opts.db);
      const entries = queue.list();

      if (entries.length === 0) {
        console.log("✅ Dead Letter Queue is empty.");
        return;
      }

      console.log(`\n📬 Dead Letter Queue — ${entries.length} packet(s)\n`);
      console.log(
        "─".repeat(72)
      );

      for (const entry of entries) {
        console.log(`ID:       ${entry.id}`);
        console.log(`Packet:   ${entry.packet.packetId} (${entry.packet.type})`);
        console.log(`Route:    ${entry.packet.sender} → ${entry.packet.target}`);
        console.log(`Error:    ${entry.error}`);
        console.log(`Attempts: ${entry.attempts}`);
        console.log(`Seen:     ${entry.firstSeen}`);
        console.log("─".repeat(72));
      }
    });

  // ── inspect ────────────────────────────────
  dlq
    .command("inspect <id>")
    .description("Show the full packet stored for a DLQ entry")
    .option("--db <path>", "Path to mailman.db", DEFAULT_DB_PATH)
    .action((id: string, opts: { db: string }) => {
      const queue = new DeadLetterQueue(opts.db);
      const entry = queue.get(id);

      if (!entry) {
        console.error(`❌ No DLQ entry found with id: ${id}`);
        process.exit(1);
      }

      console.log(`\nDLQ Entry: ${entry.id}\n`);
      console.log("Packet:");
      console.log(JSON.stringify(entry.packet, null, 2));
      console.log(`\nError:    ${entry.error}`);
      console.log(`Attempts: ${entry.attempts}`);
      console.log(`First:    ${entry.firstSeen}`);
      console.log(`Last:     ${entry.lastSeen}`);
    });

  // ── drop ───────────────────────────────────
  dlq
    .command("drop <id>")
    .description("Remove a specific entry from the Dead Letter Queue")
    .option("--db <path>", "Path to mailman.db", DEFAULT_DB_PATH)
    .action((id: string, opts: { db: string }) => {
      const queue = new DeadLetterQueue(opts.db);
      const entry = queue.get(id);

      if (!entry) {
        console.error(`❌ No DLQ entry found with id: ${id}`);
        process.exit(1);
      }

      queue.remove(id);
      console.log(`🗑️  Dropped DLQ entry: ${id}`);
    });

  // ── clear ──────────────────────────────────
  dlq
    .command("clear")
    .description("Clear the entire Dead Letter Queue")
    .option("--db <path>", "Path to mailman.db", DEFAULT_DB_PATH)
    .action((opts: { db: string }) => {
      const queue = new DeadLetterQueue(opts.db);
      const count = queue.count();
      queue.clear();
      console.log(`🗑️  Cleared ${count} DLQ entry(s).`);
    });
}
