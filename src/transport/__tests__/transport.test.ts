import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Runtime } from "../../core/runtime";
import { MailmanServer } from "../../transport/server";
import { RemoteMailmanClient } from "../../transport/remoteClient";
import { createPacket } from "../../packet/createPacket";
import { MailmanPacket } from "../../packet/types";

// Use a non-conflicting port for tests
const PORT = 17337;

describe("MailmanServer + RemoteMailmanClient", () => {
  let runtime: Runtime;
  let server: MailmanServer;
  let client: RemoteMailmanClient;

  beforeAll(async () => {
    runtime = new Runtime({ dbPath: ":memory:" });

    runtime.registerRole(
      { name: "echo-worker", accepts: ["task.assign"] },
      async (pkt: MailmanPacket) =>
        createPacket({
          taskId: pkt.taskId,
          parentPacketId: pkt.packetId,
          type: "task.result",
          sender: "echo-worker",
          target: pkt.sender,
          payload: { echoed: pkt.payload },
          status: "completed",
        })
    );

    runtime.registerRole(
      { name: "pong-role", accepts: ["health.ping"] },
      async (pkt: MailmanPacket) =>
        createPacket({
          taskId: pkt.taskId,
          parentPacketId: pkt.packetId,
          type: "health.pong",
          sender: "pong-role",
          target: pkt.sender,
          payload: {},
        })
    );

    runtime.start();

    server = new MailmanServer(runtime, { port: PORT });
    await server.listen();

    client = new RemoteMailmanClient({
      url: `http://127.0.0.1:${PORT}`,
      timeoutMs: 5000,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it("GET /health returns running status and role names", async () => {
    const health = await client.health();
    expect(health.running).toBe(true);
    expect(health.roles).toContain("echo-worker");
    expect(health.roles).toContain("pong-role");
  });

  it("GET /roles lists all registered roles", async () => {
    const roles = await client.listRoles();
    const names = roles.map((r) => r.name);
    expect(names).toContain("echo-worker");
  });

  it("POST /packets routes a packet and returns the reply", async () => {
    const packet = createPacket({
      taskId: "transport-test-1",
      type: "task.assign",
      sender: "remote-client",
      target: "echo-worker",
      payload: { hello: "world" },
    });

    const reply = await client.send(packet);
    expect(reply.type).toBe("task.result");
    expect(reply.status).toBe("completed");
    expect((reply.payload.echoed as Record<string, unknown>).hello).toBe("world");
  });

  it("ping returns true for a registered role", async () => {
    const alive = await client.ping("echo-worker");
    expect(alive).toBe(true);
  });

  it("ping returns false for an unknown role", async () => {
    const alive = await client.ping("nobody");
    expect(alive).toBe(false);
  });

  it("POST /packets returns error.report for unknown target", async () => {
    const packet = createPacket({
      taskId: "transport-test-2",
      type: "task.assign",
      sender: "client",
      target: "ghost",
      payload: {},
    });

    const reply = await client.send(packet);
    expect(reply.type).toBe("error.report");
    expect(reply.error?.code).toBe("UNKNOWN_TARGET");
  });
});
