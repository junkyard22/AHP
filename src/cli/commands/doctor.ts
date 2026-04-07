import { Command } from "commander";
import { getRuntime } from "../../core/runtime";
import { Validator } from "../../core/validator";
import { Registry } from "../../core/registry";
import { TraceStore } from "../../core/traceStore";
import { createPacket } from "../../packet/createPacket";

type CheckResult = { name: string; ok: boolean; detail?: string };

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Runtime started
  const runtime = getRuntime();
  results.push({
    name: "Runtime started",
    ok: runtime.isRunning(),
    detail: runtime.isRunning() ? undefined : "Call `mailman start` first",
  });

  // 2. Registry present and accessible
  try {
    const roles = runtime.listRoles();
    results.push({
      name: "Registry accessible",
      ok: true,
      detail: `${roles.length} role(s) registered`,
    });
  } catch (err) {
    results.push({
      name: "Registry accessible",
      ok: false,
      detail: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 3. TraceStore working
  try {
    const store = new TraceStore();
    store.record("check_pkt", "check_task", "packet.received", "doctor");
    const entries = store.getByPacket("check_pkt");
    results.push({
      name: "Trace store working",
      ok: entries.length === 1,
    });
  } catch (err) {
    results.push({
      name: "Trace store working",
      ok: false,
      detail: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 4. Packet validation working
  try {
    const registry = new Registry();
    const validator = new Validator(registry);
    // intentionally invalid packet — missing target
    const badPacket = createPacket({
      taskId: "t1",
      type: "task.assign",
      sender: "doctor",
      target: "",
      payload: {},
    });
    const result = validator.validate(badPacket);
    results.push({
      name: "Packet validation working",
      ok: !result.ok, // correctly rejected invalid packet
      detail: result.ok ? "Did not reject invalid packet" : "Correctly rejects invalid packets",
    });
  } catch (err) {
    results.push({
      name: "Packet validation working",
      ok: false,
      detail: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 5. Handlers responding (ping all roles that accept health.ping)
  const roles = runtime.listRoles();
  const pingable = roles.filter((r) => r.accepts.includes("health.ping"));

  if (pingable.length === 0) {
    results.push({
      name: "Handlers responding",
      ok: true,
      detail: "No pingable roles registered",
    });
  } else {
    for (const role of pingable) {
      const alive = await runtime.ping(role.name);
      results.push({
        name: `Handler ping: ${role.name}`,
        ok: alive,
        detail: alive ? "pong received" : "no pong",
      });
    }
  }

  return results;
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Run system health checks")
    .action(async () => {
      console.log("");
      console.log("  Mailman Doctor");
      console.log("  ──────────────────────────────────────────────────");

      const checks = await runChecks();
      let allOk = true;

      for (const check of checks) {
        const icon = check.ok ? "✓" : "✗";
        const detail = check.detail ? `  — ${check.detail}` : "";
        console.log(`  ${icon}  ${check.name}${detail}`);
        if (!check.ok) allOk = false;
      }

      console.log("");
      if (allOk) {
        console.log("  All checks passed.");
      } else {
        console.log("  Some checks failed. Review the output above.");
        process.exitCode = 1;
      }
      console.log("");
    });
}
