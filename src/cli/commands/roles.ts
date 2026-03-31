import { Command } from "commander";
import { getRuntime } from "../../core/runtime";

const HEALTH_ICONS: Record<string, string> = {
  healthy: "●",
  degraded: "◑",
  offline: "○",
  unknown: "?",
};

export function registerRoles(program: Command): void {
  program
    .command("agents")
    .alias("roles")
    .description("List registered agents and their health")
    .action(() => {
      const runtime = getRuntime();
      const agents = runtime.listAgents();

      if (agents.length === 0) {
        console.log("[postmaster] No agents registered.");
        return;
      }

      console.log("");
      console.log(`  Registered Agents (${agents.length})`);
      console.log("  ──────────────────────────────────────────────────");

      for (const agent of agents) {
        const icon = HEALTH_ICONS[agent.health ?? "unknown"];
        const health = agent.health ?? "unknown";
        const version = agent.version ? `  v${agent.version}` : "";
        const kind = agent.kind ? `  (${agent.kind})` : "";
        console.log(`  ${icon} ${agent.name}${version}${kind}  [${health}]`);

        if (agent.description) {
          console.log(`      ${agent.description}`);
        }

        if (agent.accepts.length > 0) {
          console.log(`      accepts: ${agent.accepts.join(", ")}`);
        }

        if (agent.capabilities && agent.capabilities.length > 0) {
          console.log(`      capabilities: ${agent.capabilities.join(", ")}`);
        }

        if (agent.intents && agent.intents.length > 0) {
          console.log(`      intents: ${agent.intents.join(", ")}`);
        }

        if (agent.protocols && agent.protocols.length > 0) {
          console.log(`      protocols: ${agent.protocols.join(", ")}`);
        }

        console.log("");
      }
    });
}
