import { describe, it, expect, beforeEach } from "vitest";
import { Registry } from "../registry";
import { MailmanRoleRegistration, MailmanPacket } from "../../packet/types";

function noop(): Promise<MailmanPacket> {
  return Promise.reject(new Error("noop handler called"));
}

const baseRole: MailmanRoleRegistration = {
  name: "agent",
  accepts: ["task.assign"],
  description: "A test role",
};

describe("Registry", () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
  });

  it("registers a role", () => {
    registry.register(baseRole, noop);
    expect(registry.has("agent")).toBe(true);
    expect(registry.size()).toBe(1);
  });

  it("throws on duplicate registration", () => {
    registry.register(baseRole, noop);
    expect(() => registry.register(baseRole, noop)).toThrow("already registered");
  });

  it("retrieves a registered role", () => {
    registry.register(baseRole, noop);
    const entry = registry.get("agent");
    expect(entry).toBeDefined();
    expect(entry?.registration.name).toBe("agent");
    expect(entry?.handler).toBe(noop);
  });

  it("returns undefined for unknown role", () => {
    expect(registry.get("ghost")).toBeUndefined();
  });

  it("unregisters a role", () => {
    registry.register(baseRole, noop);
    registry.unregister("agent");
    expect(registry.has("agent")).toBe(false);
  });

  it("throws when unregistering unknown role", () => {
    expect(() => registry.unregister("ghost")).toThrow("Role not found");
  });

  it("lists all registered roles", () => {
    registry.register(baseRole, noop);
    registry.register({ name: "reviewer", accepts: ["review.request"] }, noop);
    const names = registry.list().map((r) => r.name);
    expect(names).toContain("agent");
    expect(names).toContain("reviewer");
    expect(names.length).toBe(2);
  });
});
