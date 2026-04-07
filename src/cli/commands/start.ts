import { Command } from "commander";
import { getRuntime } from "../../core/runtime";

export function registerStart(program: Command): void {
  program
    .command("start")
    .description("Start the Mailman local runtime")
    .action(() => {
      const runtime = getRuntime();
      if (runtime.isRunning()) {
        console.log("[mailman] Runtime is already running.");
        return;
      }
      runtime.start();
      console.log("[mailman] Runtime started.");
      console.log("[mailman] Waiting for packets... (press Ctrl+C to stop)");

      process.on("SIGINT", () => {
        runtime.stop();
        console.log("\n[mailman] Runtime stopped.");
        process.exit(0);
      });
    });
}
