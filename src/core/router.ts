import { MailmanPacket } from "../packet/types";
import { Registry } from "./registry";
import { MailmanError, ErrorCode } from "./errors";

// ─────────────────────────────────────────────
//  Router — resolves and dispatches to handler
// ─────────────────────────────────────────────

export class Router {
  constructor(private readonly registry: Registry) {}

  /**
   * Resolve the handler for a packet's target and call it.
   * Throws MailmanError if the target is not found.
   */
  async dispatch(packet: MailmanPacket): Promise<MailmanPacket> {
    const entry = this.registry.get(packet.target);
    if (!entry) {
      throw new MailmanError(
        ErrorCode.UNKNOWN_TARGET,
        `No handler registered for target: ${packet.target}`
      );
    }
    return entry.handler(packet);
  }
}
