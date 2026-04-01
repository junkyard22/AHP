/**
 * examples/basic-ping/index.ts
 *
 * The simplest possible Mailman demo.
 * Two roles: "orchestrator" pings "agent", agent pongs back.
 *
 * Run with: npx ts-node examples/basic-ping/index.ts
 */

import { Runtime, createPacket } from "../../src/index";

async function main() {
  const runtime = new Runtime();
  runtime.start();

  // Register an agent that responds to health checks
  runtime.registerRole(
    {
      name: "agent",
      accepts: ["health.ping"],
      description: "A simple agent that responds to pings",
    },
    async (packet) => {
      console.log(`  [agent] received ${packet.type} from ${packet.sender}`);
      return createPacket({
        taskId: packet.taskId,
        parentPacketId: packet.packetId,
        type: "health.pong",
        sender: "agent",
        target: packet.sender,
        payload: { status: "healthy" },
      });
    }
  );

  // Ping the agent
  const alive = await runtime.ping("agent");
  console.log(`\n✅ Agent is ${alive ? "online" : "offline"}\n`);

  // Send a manual ping packet and inspect the reply
  runtime.registerRole(
    { name: "orchestrator", accepts: ["health.pong"] },
    async (p) => p
  );

  const pingPacket = createPacket({
    taskId: "demo-task-1",
    type: "health.ping",
    sender: "orchestrator",
    target: "agent",
    payload: {},
  });

  const reply = await runtime.send(pingPacket);
  console.log("Reply packet:");
  console.log(JSON.stringify(reply, null, 2));

  // Print the trace
  const trace = runtime.getTrace(pingPacket.packetId);
  console.log(`\nTrace (${trace.length} events):`);
  trace.forEach((e) => console.log(`  [${e.event}] by ${e.actor}`));
}

main().catch(console.error);
