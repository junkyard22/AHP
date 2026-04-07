import { describe, it, expect } from "vitest";
import { createPacket, createReply } from "../createPacket";

describe("createPacket", () => {
  it("fills in packetId if not provided", () => {
    const pkt = createPacket({
      taskId: "t1",
      type: "task.assign",
      sender: "orch",
      target: "worker",
      payload: {},
    });
    expect(pkt.packetId).toBeTruthy();
    expect(typeof pkt.packetId).toBe("string");
  });

  it("fills in timestamp if not provided", () => {
    const pkt = createPacket({
      taskId: "t1",
      type: "task.assign",
      sender: "orch",
      target: "worker",
      payload: {},
    });
    expect(pkt.timestamp).toBeTruthy();
    expect(() => new Date(pkt.timestamp)).not.toThrow();
  });

  it("preserves provided packetId", () => {
    const pkt = createPacket({
      packetId: "my-custom-id",
      taskId: "t1",
      type: "task.assign",
      sender: "orch",
      target: "worker",
      payload: {},
    });
    expect(pkt.packetId).toBe("my-custom-id");
  });

  it("generates unique packetIds for separate calls", () => {
    const a = createPacket({ taskId: "t", type: "task.assign", sender: "s", target: "t2", payload: {} });
    const b = createPacket({ taskId: "t", type: "task.assign", sender: "s", target: "t2", payload: {} });
    expect(a.packetId).not.toBe(b.packetId);
  });
});

describe("createReply", () => {
  const original = createPacket({
    packetId: "original-id",
    taskId: "task-99",
    type: "task.assign",
    sender: "orch",
    target: "worker",
    payload: { prompt: "go" },
  });

  it("sets parentPacketId to the original packetId", () => {
    const reply = createReply(original, "task.result", "worker", { done: true });
    expect(reply.parentPacketId).toBe("original-id");
  });

  it("inherits taskId from the original", () => {
    const reply = createReply(original, "task.result", "worker", { done: true });
    expect(reply.taskId).toBe("task-99");
  });

  it("flips sender and target", () => {
    const reply = createReply(original, "task.result", "worker", { done: true });
    expect(reply.sender).toBe("worker");
    expect(reply.target).toBe("orch");
  });

  it("applies overrides", () => {
    const reply = createReply(original, "task.result", "worker", {}, { status: "completed" });
    expect(reply.status).toBe("completed");
  });
});
