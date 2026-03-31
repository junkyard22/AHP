import { Command } from "commander";
import { getRuntime } from "../../core/runtime";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Show runtime status")
    .action(() => {
      const runtime = getRuntime();
      const stats = runtime.getStats();
      const roles = runtime.listRoles();

      console.log("");
      console.log("  Mailman Status");
      console.log("  ──────────────────────────────");
      console.log(`  Running:            ${runtime.isRunning() ? "yes" : "no"}`);
      console.log(`  Started at:         ${stats.startedAt ?? "—"}`);
      console.log(`  Registered roles:   ${roles.length}`);
      console.log(`  Packets processed:  ${stats.packetsProcessed}`);
      console.log(`  Packets failed:     ${stats.packetsFailed}`);
      console.log("");
    });
}
