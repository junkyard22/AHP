import {
  MailmanPacket,
  MailmanRoleRegistration,
  MailmanTraceEntry,
  PacketHandler,
  StreamHandler,
} from "../packet/types";
import { Runtime } from "../core/runtime";
import { BalanceStrategy } from "../core/loadBalancer";
import { ScheduledEntry } from "../core/scheduler";

// ─────────────────────────────────────────────
//  MailmanClient — fluent wrapper around Runtime
// ─────────────────────────────────────────────

export class MailmanClient {
  constructor(private readonly runtime: Runtime) {}

  // ── Role management ───────────────────────

  registerRole(role: MailmanRoleRegistration, handler: PacketHandler): this {
    this.runtime.registerRole(role, handler);
    return this;
  }

  registerStreamRole(role: MailmanRoleRegistration, handler: StreamHandler): this {
    this.runtime.registerStreamRole(role, handler);
    return this;
  }

  unregisterRole(name: string): this {
    this.runtime.unregisterRole(name);
    return this;
  }

  listRoles(): MailmanRoleRegistration[] {
    return this.runtime.listRoles();
  }

  // ── Item 1: Custom packet types ───────────

  registerPacketType(type: string): this {
    this.runtime.registerPacketType(type);
    return this;
  }

  // ── Item 2: Request/reply messaging ───────

  async send(packet: MailmanPacket): Promise<MailmanPacket> {
    return this.runtime.send(packet);
  }

  async ping(roleName: string): Promise<boolean> {
    return this.runtime.ping(roleName);
  }

  // ── Item 2: Fire-and-forget ───────────────

  dispatch(packet: MailmanPacket): this {
    this.runtime.dispatch(packet);
    return this;
  }

  // ── Item 2: Pub/Sub ───────────────────────

  /**
   * Subscribe to packets by topic pattern.
   * Supports exact type, "task.*", or "*" for all.
   * Returns an unsubscribe function.
   */
  subscribe(topic: string, handler: (packet: MailmanPacket) => void): () => void {
    return this.runtime.subscribe(topic, handler);
  }

  publish(packet: MailmanPacket): this {
    this.runtime.publish(packet);
    return this;
  }

  // ── Item 4: Streaming ─────────────────────

  async openStream(packet: MailmanPacket): Promise<AsyncIterable<string>> {
    return this.runtime.openStream(packet);
  }

  // ── Item 6: Capability routing ────────────

  async sendToCapability(
    capability: string,
    packet: MailmanPacket,
    strategy?: BalanceStrategy
  ): Promise<MailmanPacket> {
    return this.runtime.sendToCapability(capability, packet, strategy);
  }

  // ── Item 7: Ack/nack ──────────────────────

  async sendWithAck(packet: MailmanPacket): Promise<{
    ack: MailmanPacket;
    result: Promise<MailmanPacket>;
  }> {
    return this.runtime.sendWithAck(packet);
  }

  deliverResult(taskId: string, result: MailmanPacket): this {
    this.runtime.deliverResult(taskId, result);
    return this;
  }

  // ── Item 8: Scheduling ────────────────────

  schedulePacket(packet: MailmanPacket, deliverAt: Date): string {
    return this.runtime.schedulePacket(packet, deliverAt);
  }

  scheduleAfter(packet: MailmanPacket, delayMs: number): string {
    return this.runtime.scheduleAfter(packet, delayMs);
  }

  scheduleRecurring(packet: MailmanPacket, intervalMs: number, startAt?: Date): string {
    return this.runtime.scheduleRecurring(packet, intervalMs, startAt);
  }

  cancelScheduled(scheduleId: string): boolean {
    return this.runtime.cancelScheduled(scheduleId);
  }

  listScheduled(): ScheduledEntry[] {
    return this.runtime.listScheduled();
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

export function createClient(runtime: Runtime): MailmanClient {
  return new MailmanClient(runtime);
}
