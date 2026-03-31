import { Command } from "commander";
import { getRuntime } from "../../core/runtime";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Show runtime status")
    .action(() => {
      const runtime = getRuntime();
      const stats = runtime.getStats();
      const agents = runtime.listAgents();
      const observers = runtime.listObservers();

      console.log("");
      console.log("  Postmaster Status");
      console.log("  ──────────────────────────────");
      console.log(`  Running:            ${runtime.isRunning() ? "yes" : "no"}`);
      console.log(`  Started at:         ${stats.startedAt ?? "—"}`);
      console.log(`  Registered agents:  ${agents.length}`);
      console.log(`  Registered observers: ${observers.length}`);
      console.log(`  Messages processed: ${stats.messagesProcessed}`);
      console.log(`  Messages failed:    ${stats.messagesFailed}`);
      console.log(`  Slow messages:      ${stats.slowMessages}`);
      console.log(`  Observations logged: ${stats.observationsRecorded}`);
      console.log("");
    });
}
