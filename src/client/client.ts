import {
  MailmanPacket,
  MailmanRoleRegistration,
  MailmanTraceEntry,
  PacketHandler,
} from "../packet/types";
import { Runtime } from "../core/runtime";

// ─────────────────────────────────────────────
//  MailmanClient — thin wrapper around Runtime
//  Provides the public API surface described
//  in the MailmanRuntime interface.
// ─────────────────────────────────────────────

export class MailmanClient {
  constructor(private readonly runtime: Runtime) {}

  // ── Role management ───────────────────────

  registerRole(role: MailmanRoleRegistration, handler: PacketHandler): this {
    this.runtime.registerRole(role, handler);
    return this;
  }

  unregisterRole(name: string): this {
    this.runtime.unregisterRole(name);
    return this;
  }

  listRoles(): MailmanRoleRegistration[] {
    return this.runtime.listRoles();
  }

  // ── Messaging ─────────────────────────────

  async send(packet: MailmanPacket): Promise<MailmanPacket> {
    return this.runtime.send(packet);
  }

  async ping(roleName: string): Promise<boolean> {
    return this.runtime.ping(roleName);
  }

  // ── Trace ─────────────────────────────────

  getTrace(packetId: string): MailmanTraceEntry[] {
    return this.runtime.getTrace(packetId);
  }

  getTaskTrace(taskId: string): MailmanTraceEntry[] {
    return this.runtime.getTaskTrace(taskId);
  }

  // ── Lifecycle ─────────────────────────────

  start(): this {
    this.runtime.start();
    return this;
  }

  stop(): this {
    this.runtime.stop();
    return this;
  }

  isRunning(): boolean {
    return this.runtime.isRunning();
  }
}

// ─────────────────────────────────────────────
//  Factory
// ─────────────────────────────────────────────

/**
 * Create a fresh MailmanClient backed by the provided Runtime.
 */
export function createClient(runtime: Runtime): MailmanClient {
  return new MailmanClient(runtime);
}
