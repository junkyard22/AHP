import { describe, it, expect, beforeEach } from "vitest";
import { Validator } from "../validator";
import { Registry } from "../registry";
import { MailmanPacket } from "../../packet/types";

function validPacket(overrides: Partial<MailmanPacket> = {}): MailmanPacket {
  return {
    packetId: "pkt-1",
    taskId: "task-1",
    type: "task.assign",
    sender: "orchestrator",
    target: "worker",
    timestamp: new Date().toISOString(),
    payload: { prompt: "do work" },
    ...overrides,
  };
}

describe("Validator", () => {
  let registry: Registry;
  let validator: Validator;

  beforeEach(() => {
    registry = new Registry();
    registry.register(
      { name: "worker", accepts: ["task.assign", "health.ping"] },
      async (p) => p
    );
    validator = new Validator(registry);
  });

  it("passes a valid packet", () => {
    const result = validator.validate(validPacket());
    expect(result.ok).toBe(true);
  });

  it("rejects missing packetId", () => {
    const result = validator.validate(validPacket({ packetId: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/packetId/i);
  });

  it("rejects missing taskId", () => {
    const result = validator.validate(validPacket({ taskId: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/taskId/i);
  });

  it("rejects missing sender", () => {
    const result = validator.validate(validPacket({ sender: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/sender/i);
  });

  it("rejects missing target", () => {
    const result = validator.validate(validPacket({ target: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/target/i);
  });

  it("rejects null payload", () => {
    const result = validator.validate(
      validPacket({ payload: undefined as unknown as Record<string, unknown> })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/payload/i);
  });

  it("rejects unknown packet type", () => {
    const result = validator.validate(
      validPacket({ type: "unknown.type" as never })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Unknown packet type/i);
  });

  it("rejects confidence below 0", () => {
    const result = validator.validate(validPacket({ confidence: -0.1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/confidence/i);
  });

  it("rejects confidence above 1", () => {
    const result = validator.validate(validPacket({ confidence: 1.5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/confidence/i);
  });

  it("accepts confidence exactly at boundaries (0 and 1)", () => {
    expect(validator.validate(validPacket({ confidence: 0 })).ok).toBe(true);
    expect(validator.validate(validPacket({ confidence: 1 })).ok).toBe(true);
  });

  it("rejects unregistered target", () => {
    const result = validator.validate(validPacket({ target: "ghost" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNKNOWN_TARGET");
  });

  it("rejects packet type not accepted by target", () => {
    const result = validator.validate(validPacket({ type: "review.request" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TARGET_REJECTS_TYPE");
  });
});
