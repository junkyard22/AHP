import { describe, it, expect, vi } from "vitest";
import { Runtime } from "../runtime";
import { MemoryTraceStore, MemoryDLQStore } from "../backends";
import { newPacketId, newTaskId } from "../../utils/ids";
import { now } from "../../utils/time";
import { MailmanPacket } from "../../packet/types";

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function makeRuntime() {
  return new Runtime({
    traceStore: new MemoryTraceStore(),
    dlq: new MemoryDLQStore(),
  });
}

function pkt(overrides: Partial<MailmanPacket> = {}): MailmanPacket {
  return {
    packetId: newPacketId(),
    taskId: newTaskId(),
    type: "task.assign",
    sender: "test",
    target: "worker",
    timestamp: now(),
    payload: {},
    ...overrides,
  };
}

// ─────────────────────────────────────────────
//  Item 1 — Custom packet types
// ─────────────────────────────────────────────

describe("Item 1: custom packet types", () => {
  it("rejects unknown type before registration", async () => {
    const rt = makeRuntime();
    rt.start();
    rt.registerRole({ name: "worker", accepts: ["my.event" as any] }, async (p) => p);

    const reply = await rt.send(pkt({ type: "my.event" as any }));
    expect(reply.type).toBe("error.report");
    expect(reply.error?.message).toMatch(/Unknown packet type/);
  });

  it("accepts type after registerPacketType()", async () => {
    const rt = makeRuntime();
    rt.start();
    rt.registerPacketType("my.event");
    rt.registerRole({ name: "worker", accepts: ["my.event" as any] }, async (p) => ({
      ...p, type: "task.result" as any, sender: "worker", target: p.sender,
    }));

    const reply = await rt.send(pkt({ type: "my.event" as any }));
    expect(reply.type).toBe("task.result");
  });
});

// ─────────────────────────────────────────────
//  Item 2 — Pub/Sub + fire-and-forget
// ─────────────────────────────────────────────

describe("Item 2: pub/sub + fire-and-forget", () => {
  it("publish delivers to exact-match subscriber", () => {
    const rt = makeRuntime();
    rt.start();

    const received: MailmanPacket[] = [];
    rt.subscribe("task.result", (p) => received.push(p));

    const packet = pkt({ type: "task.result" });
    rt.publish(packet);

    expect(received).toHaveLength(1);
    expect(received[0].packetId).toBe(packet.packetId);
  });

  it("wildcard topic matches prefix", () => {
    const rt = makeRuntime();
    rt.start();

    const received: MailmanPacket[] = [];
    rt.subscribe("task.*", (p) => received.push(p));

    rt.publish(pkt({ type: "task.assign" }));
    rt.publish(pkt({ type: "task.result" }));
    rt.publish(pkt({ type: "health.ping" })); // should NOT match

    expect(received).toHaveLength(2);
  });

  it("unsubscribe stops delivery", () => {
    const rt = makeRuntime();
    rt.start();

    const received: MailmanPacket[] = [];
    const unsub = rt.subscribe("*", (p) => received.push(p));

    rt.publish(pkt({ type: "task.assign" }));
    unsub();
    rt.publish(pkt({ type: "task.assign" }));

    expect(received).toHaveLength(1);
  });

  it("dispatch is fire-and-forget (returns void)", async () => {
    const rt = makeRuntime();
    rt.start();

    const handled: string[] = [];
    rt.registerRole({ name: "worker", accepts: ["task.assign"] }, async (p) => {
      handled.push(p.packetId);
      return { ...p, type: "task.result" as const, sender: "worker", target: p.sender };
    });

    rt.dispatch(pkt());
    // give the async work a tick
    await new Promise((r) => setTimeout(r, 20));
    expect(handled).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────
//  Item 4 — Streaming
// ─────────────────────────────────────────────

describe("Item 4: streaming", () => {
  it("streams chunks to consumer", async () => {
    const rt = makeRuntime();
    rt.start();

    rt.registerStreamRole(
      { name: "worker", accepts: ["stream.open"] },
      async (_packet, stream) => {
        stream.push("hello");
        stream.push(" ");
        stream.push("world");
        stream.end();
      }
    );

    const iterable = await rt.openStream(pkt({ type: "stream.open", target: "worker" }));

    const chunks: string[] = [];
    for await (const chunk of iterable) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("hello world");
  });

  it("propagates stream errors", async () => {
    const rt = makeRuntime();
    rt.start();

    rt.registerStreamRole(
      { name: "worker", accepts: ["stream.open"] },
      async (_packet, stream) => {
        stream.push("partial");
        stream.error(new Error("boom"));
      }
    );

    const iterable = await rt.openStream(pkt({ type: "stream.open", target: "worker" }));

    const chunks: string[] = [];
    await expect(async () => {
      for await (const chunk of iterable) {
        chunks.push(chunk);
      }
    }).rejects.toThrow("boom");

    expect(chunks).toEqual(["partial"]);
  });
});

// ─────────────────────────────────────────────
//  Item 6 — Capability routing + load balancing
// ─────────────────────────────────────────────

describe("Item 6: capability routing", () => {
  it("routes to a role with the requested capability", async () => {
    const rt = makeRuntime();
    rt.start();

    const handled: string[] = [];

    rt.registerRole(
      { name: "summarizer", accepts: ["task.assign"], capabilities: ["summarize"] },
      async (p) => {
        handled.push("summarizer");
        return { ...p, type: "task.result" as const, sender: "summarizer", target: p.sender };
      }
    );

    await rt.sendToCapability("summarize", pkt());
    expect(handled).toContain("summarizer");
  });

  it("returns error packet when no capable role exists", async () => {
    const rt = makeRuntime();
    rt.start();

    const reply = await rt.sendToCapability("translate", pkt());
    expect(reply.type).toBe("error.report");
    expect(reply.error?.code).toBe("NO_CAPABLE_ROLE");
  });

  it("round-robins across multiple capable roles", async () => {
    const rt = makeRuntime();
    rt.start();

    const hits: string[] = [];

    for (const name of ["w1", "w2", "w3"]) {
      const n = name;
      rt.registerRole(
        { name: n, accepts: ["task.assign"], capabilities: ["work"] },
        async (p) => {
          hits.push(n);
          return { ...p, type: "task.result" as const, sender: n, target: p.sender };
        }
      );
    }

    await rt.sendToCapability("work", pkt());
    await rt.sendToCapability("work", pkt());
    await rt.sendToCapability("work", pkt());

    // All three should have been called (round-robin)
    expect(new Set(hits).size).toBe(3);
  });
});

// ─────────────────────────────────────────────
//  Item 7 — Ack/nack
// ─────────────────────────────────────────────

describe("Item 7: ack/nack", () => {
  it("sendWithAck receives ack immediately then result asynchronously", async () => {
    const rt = makeRuntime();
    rt.start();

    rt.registerRole({ name: "worker", accepts: ["task.assign"] }, async (p) => {
      // Simulate async work in background
      setTimeout(() => {
        rt.deliverResult(p.taskId, {
          ...p,
          packetId: newPacketId(),
          type: "task.result",
          sender: "worker",
          target: p.sender,
          payload: { done: true },
        });
      }, 10);

      // Return immediate ack
      return { ...p, packetId: newPacketId(), type: "task.ack" as const, sender: "worker", target: p.sender };
    });

    const { ack, result } = await rt.sendWithAck(pkt());
    expect(ack.type).toBe("task.ack");

    const final = await result;
    expect(final.type).toBe("task.result");
    expect(final.payload.done).toBe(true);
  });
});

// ─────────────────────────────────────────────
//  Item 8 — Scheduling
// ─────────────────────────────────────────────

describe("Item 8: scheduling", () => {
  it("scheduleAfter delivers packet after delay", async () => {
    const rt = makeRuntime();
    rt.start();

    const received: MailmanPacket[] = [];
    rt.registerRole({ name: "worker", accepts: ["task.assign"] }, async (p) => {
      received.push(p);
      return { ...p, type: "task.result" as const, sender: "worker", target: p.sender };
    });

    expect(received).toHaveLength(0);
    rt.scheduleAfter(pkt(), 20);

    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);
  });

  it("cancel prevents delivery", async () => {
    const rt = makeRuntime();
    rt.start();

    const received: MailmanPacket[] = [];
    rt.registerRole({ name: "worker", accepts: ["task.assign"] }, async (p) => {
      received.push(p);
      return { ...p, type: "task.result" as const, sender: "worker", target: p.sender };
    });

    const id = rt.scheduleAfter(pkt(), 30);
    const cancelled = rt.cancelScheduled(id);

    await new Promise((r) => setTimeout(r, 60));
    expect(cancelled).toBe(true);
    expect(received).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
//  Item 9 — Telemetry hooks
// ─────────────────────────────────────────────

describe("Item 9: telemetry hooks", () => {
  it("onTelemetry fires for each trace event", async () => {
    const events: string[] = [];

    const rt = new Runtime({
      traceStore: new MemoryTraceStore(),
      dlq: new MemoryDLQStore(),
      onTelemetry: (e) => events.push(e.type),
    });
    rt.start();

    rt.registerRole({ name: "worker", accepts: ["task.assign"] }, async (p) => ({
      ...p, type: "task.result" as const, sender: "worker", target: p.sender,
    }));

    await rt.send(pkt());
    expect(events).toContain("packet.received");
    expect(events).toContain("packet.validated");
    expect(events).toContain("packet.completed");
  });
});

// ─────────────────────────────────────────────
//  Item 10 — Pluggable backends
// ─────────────────────────────────────────────

describe("Item 10: pluggable backends", () => {
  it("MemoryTraceStore records and retrieves entries", async () => {
    const store = new MemoryTraceStore();
    const rt = new Runtime({ traceStore: store, dlq: new MemoryDLQStore() });
    rt.start();

    rt.registerRole({ name: "worker", accepts: ["task.assign"] }, async (p) => ({
      ...p, type: "task.result" as const, sender: "worker", target: p.sender,
    }));

    const packet = pkt();
    await rt.send(packet);

    const trace = store.getByPacket(packet.packetId);
    expect(trace.length).toBeGreaterThan(0);
    expect(trace[0].event).toBe("packet.received");
  });

  it("MemoryDLQStore captures dead-lettered packets", async () => {
    const dlq = new MemoryDLQStore();
    const rt = new Runtime({
      traceStore: new MemoryTraceStore(),
      dlq,
      retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
    });
    rt.start();

    rt.registerRole({ name: "worker", accepts: ["task.assign"] }, async () => {
      throw new Error("intentional failure");
    });

    await rt.send(pkt());
    expect(dlq.count()).toBe(1);
  });
});
