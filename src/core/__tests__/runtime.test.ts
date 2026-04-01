import { describe, it, expect, beforeEach } from "vitest";
import { Runtime } from "../runtime";
import { createPacket } from "../../packet/createPacket";
import { MailmanPacket } from "../../packet/types";

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function makeRuntime() {
  const rt = new Runtime({ dbPath: ":memory:", retry: { maxAttempts: 1 } });
  rt.start();
  return rt;
}

function echoHandler(packet: MailmanPacket): Promise<MailmanPacket> {
  return Promise.resolve(
    createPacket({
      taskId: packet.taskId,
      parentPacketId: packet.packetId,
      type: "task.result",
      sender: packet.target,
      target: packet.sender,
      payload: { echo: packet.payload },
      status: "completed",
    })
  );
}

// ─────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────

describe("Runtime", () => {
  let rt: Runtime;

  beforeEach(() => {
    rt = makeRuntime();
  });

  // ── Happy path ──────────────────────────────

  it("delivers a packet and returns a response", async () => {
    rt.registerRole(
      { name: "worker", accepts: ["task.assign"] },
      (pkt) =>
        Promise.resolve(
          createPacket({
            taskId: pkt.taskId,
            type: "task.result",
            sender: "worker",
            target: pkt.sender,
            payload: { done: true },
            status: "completed",
          })
        )
    );

    const packet = createPacket({
      taskId: "t1",
      type: "task.assign",
      sender: "orchestrator",
      target: "worker",
      payload: { prompt: "hello" },
    });

    const reply = await rt.send(packet);
    expect(reply.type).toBe("task.result");
    expect(reply.status).toBe("completed");
  });

  // ── Validation rejection ─────────────────────

  it("returns an error packet when target is not registered", async () => {
    const packet = createPacket({
      taskId: "t2",
      type: "task.assign",
      sender: "orchestrator",
      target: "ghost",
      payload: {},
    });

    const reply = await rt.send(packet);
    expect(reply.type).toBe("error.report");
    expect(reply.error?.code).toBe("UNKNOWN_TARGET");
  });

  it("returns an error packet when required field is missing", async () => {
    const packet = {
      packetId: "p1",
      taskId: "t3",
      type: "task.assign",
      sender: "",
      target: "worker",
      timestamp: new Date().toISOString(),
      payload: {},
    } as MailmanPacket;

    const reply = await rt.send(packet);
    expect(reply.type).toBe("error.report");
    expect(reply.error?.message).toMatch(/sender/i);
  });

  // ── Handler error ────────────────────────────

  it("returns an error packet when handler throws", async () => {
    rt.registerRole({ name: "crasher", accepts: ["task.assign"] }, () => {
      throw new Error("boom");
    });

    const packet = createPacket({
      taskId: "t4",
      type: "task.assign",
      sender: "orchestrator",
      target: "crasher",
      payload: {},
    });

    const reply = await rt.send(packet);
    expect(reply.type).toBe("error.report");
    expect(reply.error?.message).toBe("boom");
  });

  // ── Timeout ──────────────────────────────────

  it("times out a slow handler", async () => {
    rt.registerRole({ name: "slow", accepts: ["task.assign"] }, () =>
      new Promise((resolve) => setTimeout(resolve as () => void, 500))
    );

    const packet = createPacket({
      taskId: "t5",
      type: "task.assign",
      sender: "orchestrator",
      target: "slow",
      payload: {},
      meta: { timeoutMs: 50 },
    });

    const reply = await rt.send(packet);
    expect(reply.type).toBe("error.report");
    expect(reply.error?.code).toBe("HANDLER_TIMEOUT");
  }, 10_000);

  // ── Middleware ───────────────────────────────

  it("runs middleware in order, wrapping the handler", async () => {
    const log: string[] = [];

    rt.registerRole({ name: "target", accepts: ["task.assign"] }, echoHandler);

    rt.use(async (pkt, next) => {
      log.push("mw1-before");
      const reply = await next();
      log.push("mw1-after");
      return reply;
    });

    rt.use(async (pkt, next) => {
      log.push("mw2-before");
      const reply = await next();
      log.push("mw2-after");
      return reply;
    });

    const packet = createPacket({
      taskId: "t6",
      type: "task.assign",
      sender: "orch",
      target: "target",
      payload: {},
    });

    await rt.send(packet);
    expect(log).toEqual(["mw1-before", "mw2-before", "mw2-after", "mw1-after"]);
  });

  // ── Ping ─────────────────────────────────────

  it("ping returns true when role accepts health.ping", async () => {
    rt.registerRole(
      { name: "pinger", accepts: ["health.ping"] },
      (pkt) =>
        Promise.resolve(
          createPacket({
            taskId: pkt.taskId,
            type: "health.pong",
            sender: "pinger",
            target: pkt.sender,
            payload: {},
          })
        )
    );
    expect(await rt.ping("pinger")).toBe(true);
  });

  it("ping returns false for unknown role", async () => {
    expect(await rt.ping("nobody")).toBe(false);
  });

  // ── Trace ─────────────────────────────────────

  it("records trace events for a successful send", async () => {
    rt.registerRole({ name: "tracer-target", accepts: ["task.assign"] }, echoHandler);

    const packet = createPacket({
      taskId: "t7",
      type: "task.assign",
      sender: "orch",
      target: "tracer-target",
      payload: {},
    });

    await rt.send(packet);
    const trace = rt.getTrace(packet.packetId);
    const events = trace.map((e) => e.event);
    expect(events).toContain("packet.received");
    expect(events).toContain("packet.validated");
    expect(events).toContain("handler.started");
    expect(events).toContain("packet.completed");
  });

  // ── Stats ─────────────────────────────────────

  it("increments packetsProcessed on success", async () => {
    rt.registerRole({ name: "counter", accepts: ["task.assign"] }, echoHandler);

    const packet = createPacket({
      taskId: "t8",
      type: "task.assign",
      sender: "orch",
      target: "counter",
      payload: {},
    });

    await rt.send(packet);
    expect(rt.getStats().packetsProcessed).toBe(1);
  });

  // ── DLQ ───────────────────────────────────────

  it("pushes a packet to the DLQ after handler exhausts retries", async () => {
    // Runtime with maxAttempts:1 so it fails immediately into DLQ
    const rt2 = new Runtime({
      dbPath: ":memory:",
      retry: { maxAttempts: 1 },
    });
    rt2.start();

    rt2.registerRole({ name: "boom", accepts: ["task.assign"] }, () => {
      throw new Error("always fails");
    });

    const packet = createPacket({
      taskId: "dlq-test",
      type: "task.assign",
      sender: "orch",
      target: "boom",
      payload: {},
    });

    await rt2.send(packet);

    const dlq = rt2.getDLQ();
    expect(dlq.count()).toBe(1);

    const entries = dlq.list();
    expect(entries[0].error).toBe("always fails");
    expect(entries[0].attempts).toBe(1);
  });
});
