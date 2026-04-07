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
    .command("roles")
    .description("List registered roles and their health")
    .action(() => {
      const runtime = getRuntime();
      const roles = runtime.listRoles();

      if (roles.length === 0) {
        console.log("[mailman] No roles registered.");
        return;
      }

      console.log("");
      console.log(`  Registered Roles (${roles.length})`);
      console.log("  ──────────────────────────────────────────────────");

      for (const role of roles) {
        const icon = HEALTH_ICONS[role.health ?? "unknown"];
        const health = role.health ?? "unknown";
        const version = role.version ? `  v${role.version}` : "";
        console.log(`  ${icon} ${role.name}${version}  [${health}]`);

        if (role.description) {
          console.log(`      ${role.description}`);
        }

        if (role.accepts.length > 0) {
          console.log(`      accepts: ${role.accepts.join(", ")}`);
        }

        if (role.intents && role.intents.length > 0) {
          console.log(`      intents: ${role.intents.join(", ")}`);
        }

        console.log("");
      }
    });
}
