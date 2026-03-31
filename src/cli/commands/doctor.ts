import { Command } from "commander";
import { getRuntime } from "../../core/runtime";
import { Validator } from "../../core/validator";
import { Registry } from "../../core/registry";
import { TraceStore } from "../../core/traceStore";
import { ObservationStore } from "../../core/observationStore";
import { createRequest } from "../../packet/createPacket";

type CheckResult = { name: string; ok: boolean; detail?: string };

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Runtime started
  const runtime = getRuntime();
  results.push({
    name: "Runtime started",
    ok: runtime.isRunning(),
    detail: runtime.isRunning() ? undefined : "Call `postmaster start` first",
  });

  // 2. Registry present and accessible
  try {
    const agents = runtime.listAgents();
    results.push({
      name: "Registry accessible",
      ok: true,
      detail: `${agents.length} agent(s) registered`,
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
    store.record("check_msg", "check_conversation", "message.received", "doctor");
    const entries = store.getByMessage("check_msg");
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

  // 4. ObservationStore working
  try {
    const store = new ObservationStore();
    store.record({
      messageId: "check_msg",
      conversationId: "check_conversation",
      severity: "warning",
      stage: "runtime",
      code: "doctor.test",
      summary: "Test observation",
      actor: "doctor",
    });
    const entries = store.getByMessage("check_msg");
    results.push({
      name: "Observation store working",
      ok: entries.length === 1,
    });
  } catch (err) {
    results.push({
      name: "Observation store working",
      ok: false,
      detail: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 5. Message validation working
  try {
    const registry = new Registry();
    const validator = new Validator(registry);
    const badMessage = createRequest({
      conversationId: "t1",
      sender: "doctor",
      target: "",
      payload: {},
    });
    const result = validator.validate(badMessage);
    results.push({
      name: "Message validation working",
      ok: !result.ok,
      detail: result.ok
        ? "Did not reject invalid message"
        : "Correctly rejects invalid messages",
    });
  } catch (err) {
    results.push({
      name: "Message validation working",
      ok: false,
      detail: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 6. Handlers responding (ping all agents that accept health.ping)
  const agents = runtime.listAgents();
  const pingable = agents.filter((agent) =>
    agent.accepts.includes("health.ping")
  );

  if (pingable.length === 0) {
    results.push({
      name: "Handlers responding",
      ok: true,
      detail: "No pingable agents registered",
    });
  } else {
    for (const agent of pingable) {
      const alive = await runtime.ping(agent.name);
      results.push({
        name: `Handler ping: ${agent.name}`,
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
    .description("Run Postmaster health checks")
    .action(async () => {
      console.log("");
      console.log("  Postmaster Doctor");
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
