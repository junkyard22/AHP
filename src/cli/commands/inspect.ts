import { Command } from "commander";
import { getRuntime } from "../../core/runtime";

export function registerInspect(program: Command): void {
  program
    .command("inspect <packetId>")
    .description("Show trace history for a packet")
    .action((packetId: string) => {
      const runtime = getRuntime();
      const entries = runtime.getTrace(packetId);

      if (entries.length === 0) {
        console.log(`[mailman] No trace found for packet: ${packetId}`);
        return;
      }

      console.log("");
      console.log(`  Trace for ${packetId}`);
      console.log("  ──────────────────────────────────────────────────");

      for (const entry of entries) {
        const ts = new Date(entry.timestamp).toISOString();
        console.log(`  [${ts}]  ${entry.event.padEnd(22)}  actor: ${entry.actor}`);

        if (entry.details && Object.keys(entry.details).length > 0) {
          for (const [k, v] of Object.entries(entry.details)) {
            console.log(`    ${k}: ${JSON.stringify(v)}`);
          }
        }
      }

      console.log("");
    });
}
