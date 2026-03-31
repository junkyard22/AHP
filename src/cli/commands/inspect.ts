import { Command } from "commander";
import { getRuntime } from "../../core/runtime";

export function registerInspect(program: Command): void {
  program
    .command("inspect <messageId>")
    .description("Show trace and troubleshooting details for a message")
    .action((messageId: string) => {
      const runtime = getRuntime();
      const report = runtime.createTroubleshootingReport({ messageId });

      if (report.traces.length === 0 && report.observations.length === 0) {
        console.log(`[postmaster] No activity found for message: ${messageId}`);
        return;
      }

      console.log("");
      console.log(`  Troubleshooting Report for ${messageId}`);
      console.log("  ──────────────────────────────────────────────────");
      console.log(`  Status:        ${report.status}`);
      console.log(`  Traces:        ${report.summary.totalTraces}`);
      console.log(`  Observations:  ${report.summary.totalObservations}`);
      console.log(`  Warnings:      ${report.summary.warningCount}`);
      console.log(`  Errors:        ${report.summary.errorCount}`);

      if (report.summary.participants.length > 0) {
        console.log(`  Participants:  ${report.summary.participants.join(", ")}`);
      }

      if (report.traces.length > 0) {
        console.log("");
        console.log("  Trace");
        console.log("  ──────────────────────────────────────────────────");

        for (const entry of report.traces) {
          const ts = new Date(entry.timestamp).toISOString();
          console.log(`  [${ts}]  ${entry.event.padEnd(22)}  actor: ${entry.actor}`);

          if (entry.details && Object.keys(entry.details).length > 0) {
            for (const [key, value] of Object.entries(entry.details)) {
              console.log(`    ${key}: ${JSON.stringify(value)}`);
            }
          }
        }
      }

      if (report.observations.length > 0) {
        console.log("");
        console.log("  Observations");
        console.log("  ──────────────────────────────────────────────────");

        for (const observation of report.observations) {
          const ts = new Date(observation.timestamp).toISOString();
          const label = `${observation.severity.toUpperCase()} ${observation.code}`;
          console.log(`  [${ts}]  ${label.padEnd(28)}  ${observation.summary}`);
          console.log(`    stage: ${observation.stage}  actor: ${observation.actor}`);

          if (observation.details && Object.keys(observation.details).length > 0) {
            for (const [key, value] of Object.entries(observation.details)) {
              console.log(`    ${key}: ${JSON.stringify(value)}`);
            }
          }
        }
      }

      console.log("");
    });
}
