/**
 * examples/cross-process/server.ts
 *
 * Process A: runs a MailmanServer with a "worker" role registered.
 * Any process can POST packets to it on port 7337.
 *
 * Run: npx ts-node examples/cross-process/server.ts
 */

import { Runtime, MailmanServer, createPacket } from "../../src/index";

async function main() {
  const runtime = new Runtime({ dbPath: ":memory:" });

  // Log every packet in flight
  runtime.use(async (packet, next) => {
    console.log(`  [server] → ${packet.type} from ${packet.sender}`);
    const reply = await next();
    console.log(`  [server] ← ${reply.type}`);
    return reply;
  });

  runtime.start();

  // Register roles — could be anything: AI agent, database adapter, printer driver...
  runtime.registerRole(
    {
      name: "worker",
      accepts: ["task.assign"],
      description: "Processes tasks and returns results",
    },
    async (packet) => {
      const input = String(packet.payload.text ?? "");
      const result = input.split("").reverse().join(""); // silly transform

      console.log(`  [worker] processed: "${input}" → "${result}"`);

      return createPacket({
        taskId: packet.taskId,
        parentPacketId: packet.packetId,
        type: "task.result",
        sender: "worker",
        target: packet.sender,
        payload: { result },
        status: "completed",
      });
    }
  );

  runtime.registerRole(
    {
      name: "echo",
      accepts: ["health.ping"],
      description: "Health check endpoint",
    },
    async (packet) =>
      createPacket({
        taskId: packet.taskId,
        parentPacketId: packet.packetId,
        type: "health.pong",
        sender: "echo",
        target: packet.sender,
        payload: { status: "healthy", uptime: process.uptime() },
      })
  );

  const server = new MailmanServer(runtime, { port: 7337 });
  await server.listen();

  console.log(`\n🚀 MailmanServer listening at ${server.address}`);
  console.log("   Roles: worker, echo");
  console.log("   Press Ctrl+C to stop\n");
}

main().catch(console.error);
