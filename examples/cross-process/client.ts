/**
 * examples/cross-process/client.ts
 *
 * Process B: uses RemoteMailmanClient to send packets to the server
 * running in a separate process on port 7337.
 *
 * Run (after starting server.ts):
 *   npx ts-node examples/cross-process/client.ts
 */

import { RemoteMailmanClient, createPacket } from "../../src/index";

async function main() {
  const client = new RemoteMailmanClient({
    url: "http://localhost:7337",
    timeoutMs: 5000,
  });

  // ── Health check ───────────────────────────
  console.log("\n── Checking server health ──");
  const health = await client.health();
  console.log(`  Running: ${health.running}`);
  console.log(`  Roles:   ${health.roles.join(", ")}`);

  // ── List roles ─────────────────────────────
  console.log("\n── Registered roles ──");
  const roles = await client.listRoles();
  for (const role of roles) {
    console.log(`  ${role.name} — accepts: ${role.accepts.join(", ")}`);
  }

  // ── Send a task ────────────────────────────
  console.log("\n── Sending task to worker ──");
  const packet = createPacket({
    taskId: "cross-process-demo-1",
    type: "task.assign",
    sender: "client-app",    // could be any app, service, tool...
    target: "worker",
    payload: { text: "Hello from another process!" },
  });

  const reply = await client.send(packet);

  console.log(`  Reply type:   ${reply.type}`);
  console.log(`  Reply status: ${reply.status}`);
  console.log(`  Result:       ${JSON.stringify(reply.payload.result)}`);

  // ── Ping ───────────────────────────────────
  console.log("\n── Pinging echo role ──");
  const alive = await client.ping("echo");
  console.log(`  Echo is ${alive ? "online ✅" : "offline ❌"}`);

  console.log("\n── Done ──\n");
}

main().catch((err) => {
  console.error("❌ Could not connect to MailmanServer:", err.message);
  console.error("   Make sure server.ts is running first.");
  process.exit(1);
});
