import { MailmanRoleRegistration, PacketHandler } from "../packet/types";
import { MailmanError, ErrorCode } from "./errors";

// ─────────────────────────────────────────────
//  Registry entry — combines registration + handler
// ─────────────────────────────────────────────

export type RegistryEntry = {
  registration: MailmanRoleRegistration;
  handler: PacketHandler;
  registeredAt: string;
};

// ─────────────────────────────────────────────
//  Registry
// ─────────────────────────────────────────────

export class Registry {
  private readonly entries = new Map<string, RegistryEntry>();

  register(role: MailmanRoleRegistration, handler: PacketHandler): void {
    if (this.entries.has(role.name)) {
      throw new MailmanError(
        ErrorCode.ROLE_ALREADY_REGISTERED,
        `Role already registered: ${role.name}`
      );
    }
    this.entries.set(role.name, {
      registration: role,
      handler,
      registeredAt: new Date().toISOString(),
    });
  }

  unregister(name: string): void {
    if (!this.entries.has(name)) {
      throw new MailmanError(
        ErrorCode.ROLE_NOT_FOUND,
        `Role not found: ${name}`
      );
    }
    this.entries.delete(name);
  }

  get(name: string): RegistryEntry | undefined {
    return this.entries.get(name);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  list(): MailmanRoleRegistration[] {
    return Array.from(this.entries.values()).map((e) => e.registration);
  }

  size(): number {
    return this.entries.size;
  }

  // ── Capability queries ────────────────────

  /**
   * Find all roles that advertise a specific capability.
   * Used by runtime.sendToCapability() for dynamic routing.
   */
  findByCapability(capability: string): RegistryEntry[] {
    return Array.from(this.entries.values()).filter(
      (e) => e.registration.capabilities?.includes(capability) ?? false
    );
  }

  /**
   * Find all roles that advertise ALL of the given capabilities.
   */
  findByCapabilities(capabilities: string[]): RegistryEntry[] {
    return Array.from(this.entries.values()).filter((e) =>
      capabilities.every(
        (cap) => e.registration.capabilities?.includes(cap) ?? false
      )
    );
  }
}
