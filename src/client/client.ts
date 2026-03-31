import {
  MailmanAgentRegistration,
  MailmanMessage,
  MailmanPacket,
  MailmanRoleRegistration,
  MailmanTraceEntry,
  MessageHandler,
  PacketHandler,
  PostmasterObservation,
  PostmasterObserver,
  PostmasterObserverRegistration,
  PostmasterTroubleshootingReport,
  PostmasterTroubleshootingTarget,
} from "../packet/types";
import { Postmaster } from "../core/runtime";

// ─────────────────────────────────────────────
//  PostmasterClient — thin wrapper around Postmaster
//  Provides both the new Postmaster API and the
//  older Mailman compatibility surface.
// ─────────────────────────────────────────────

export class PostmasterClient {
  constructor(private readonly runtime: Postmaster) {}

  // ── Agent management ──────────────────────

  registerAgent(agent: MailmanAgentRegistration, handler: MessageHandler): this {
    this.runtime.registerAgent(agent, handler);
    return this;
  }

  unregisterAgent(name: string): this {
    this.runtime.unregisterAgent(name);
    return this;
  }

  listAgents(): MailmanAgentRegistration[] {
    return this.runtime.listAgents();
  }

  registerRole(role: MailmanRoleRegistration, handler: PacketHandler): this {
    return this.registerAgent(role, handler);
  }

  unregisterRole(name: string): this {
    return this.unregisterAgent(name);
  }

  listRoles(): MailmanRoleRegistration[] {
    return this.listAgents();
  }

  // ── Observability ─────────────────────────

  registerObserver(observer: PostmasterObserver): this {
    this.runtime.registerObserver(observer);
    return this;
  }

  unregisterObserver(name: string): this {
    this.runtime.unregisterObserver(name);
    return this;
  }

  listObservers(): PostmasterObserverRegistration[] {
    return this.runtime.listObservers();
  }

  getMessageObservations(messageId: string): PostmasterObservation[] {
    return this.runtime.getMessageObservations(messageId);
  }

  getConversationObservations(conversationId: string): PostmasterObservation[] {
    return this.runtime.getConversationObservations(conversationId);
  }

  createTroubleshootingReport(
    target: PostmasterTroubleshootingTarget
  ): PostmasterTroubleshootingReport {
    return this.runtime.createTroubleshootingReport(target);
  }

  // ── Messaging ─────────────────────────────

  async send(packet: MailmanPacket): Promise<MailmanMessage> {
    return this.runtime.send(packet);
  }

  async ping(agentName: string): Promise<boolean> {
    return this.runtime.ping(agentName);
  }

  // ── Trace ─────────────────────────────────

  getMessageTrace(messageId: string): MailmanTraceEntry[] {
    return this.runtime.getMessageTrace(messageId);
  }

  getConversationTrace(conversationId: string): MailmanTraceEntry[] {
    return this.runtime.getConversationTrace(conversationId);
  }

  getTrace(packetId: string): MailmanTraceEntry[] {
    return this.getMessageTrace(packetId);
  }

  getTaskTrace(taskId: string): MailmanTraceEntry[] {
    return this.getConversationTrace(taskId);
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

export { PostmasterClient as MailmanClient };

// ─────────────────────────────────────────────
//  Factory
// ─────────────────────────────────────────────

export function createPostmasterClient(runtime: Postmaster): PostmasterClient {
  return new PostmasterClient(runtime);
}

export const createClient = createPostmasterClient;
