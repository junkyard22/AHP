import {
  MailmanAgentRegistration,
  MailmanRoleRegistration,
  MessageHandler,
  PacketHandler,
} from "../packet/types";
import { MailmanError, ErrorCode } from "./errors";

// ─────────────────────────────────────────────
//  Registry entry — combines agent registration + handler
// ─────────────────────────────────────────────

export type RegistryEntry = {
  registration: MailmanAgentRegistration;
  handler: MessageHandler;
  registeredAt: string;
};

// ─────────────────────────────────────────────
//  Registry
// ─────────────────────────────────────────────

export class Registry {
  private readonly entries = new Map<string, RegistryEntry>();

  register(agent: MailmanAgentRegistration, handler: MessageHandler): void {
    if (this.entries.has(agent.name)) {
      throw new MailmanError(
        ErrorCode.ROLE_ALREADY_REGISTERED,
        `Agent already registered: ${agent.name}`
      );
    }
    this.entries.set(agent.name, {
      registration: agent,
      handler,
      registeredAt: new Date().toISOString(),
    });
  }

  registerAgent(agent: MailmanAgentRegistration, handler: MessageHandler): void {
    this.register(agent, handler);
  }

  registerRole(role: MailmanRoleRegistration, handler: PacketHandler): void {
    this.register(role, handler);
  }

  unregister(name: string): void {
    if (!this.entries.has(name)) {
      throw new MailmanError(
        ErrorCode.ROLE_NOT_FOUND,
        `Agent not found: ${name}`
      );
    }
    this.entries.delete(name);
  }

  unregisterAgent(name: string): void {
    this.unregister(name);
  }

  unregisterRole(name: string): void {
    this.unregister(name);
  }

  get(name: string): RegistryEntry | undefined {
    return this.entries.get(name);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  list(): MailmanAgentRegistration[] {
    return Array.from(this.entries.values()).map((e) => e.registration);
  }

  listAgents(): MailmanAgentRegistration[] {
    return this.list();
  }

  listRoles(): MailmanRoleRegistration[] {
    return this.list();
  }

  size(): number {
    return this.entries.size;
  }
}
