import { MailmanMessage } from "../packet/types";
import { Registry } from "./registry";
import { MailmanError, ErrorCode } from "./errors";

// ─────────────────────────────────────────────
//  Router — resolves and dispatches to an agent handler
// ─────────────────────────────────────────────

export class Router {
  constructor(private readonly registry: Registry) {}

  /**
   * Resolve the handler for a message target and call it.
   * Throws MailmanError if the target is not found.
   */
  async dispatch(message: MailmanMessage): Promise<MailmanMessage> {
    const entry = this.registry.get(message.target);
    if (!entry) {
      throw new MailmanError(
        ErrorCode.UNKNOWN_TARGET,
        `No handler registered for target: ${message.target}`
      );
    }
    return entry.handler(message);
  }
}
