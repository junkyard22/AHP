import { Command } from "commander";
import { getRuntime } from "../../core/runtime";

export function registerStart(program: Command): void {
  program
    .command("start")
    .description("Start the Postmaster local agent runtime")
    .action(() => {
      const runtime = getRuntime();
      if (runtime.isRunning()) {
        console.log("[postmaster] Runtime is already running.");
        return;
      }
      runtime.start();
      console.log("[postmaster] Runtime started.");
      console.log("[postmaster] Watching agent messages... (press Ctrl+C to stop)");

      process.on("SIGINT", () => {
        runtime.stop();
        console.log("\n[postmaster] Runtime stopped.");
        process.exit(0);
      });
    });
}
