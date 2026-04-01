import { MailmanPacket } from "../packet/types";

// ─────────────────────────────────────────────
//  Middleware
//
//  A middleware function receives the packet and a `next` function.
//  Calling next() passes control to the next middleware (or the handler).
//  You can modify the packet before calling next(), or modify the response
//  after next() resolves.
//
//  Example:
//    runtime.use(async (packet, next) => {
//      console.log("→", packet.type, packet.target);
//      const reply = await next();
//      console.log("←", reply.type, reply.status);
//      return reply;
//    });
// ─────────────────────────────────────────────

export type MiddlewareFn = (
  packet: MailmanPacket,
  next: () => Promise<MailmanPacket>
) => Promise<MailmanPacket>;

// ─────────────────────────────────────────────
//  Compose — builds a single fn from an ordered list of middleware
// ─────────────────────────────────────────────

/**
 * Compose an array of middleware functions around a core dispatch fn.
 * Middleware runs in insertion order (first `use()` call runs outermost).
 */
export function composeMiddleware(
  middleware: MiddlewareFn[],
  core: (packet: MailmanPacket) => Promise<MailmanPacket>
): (packet: MailmanPacket) => Promise<MailmanPacket> {
  return function dispatch(packet: MailmanPacket): Promise<MailmanPacket> {
    let index = -1;

    function step(i: number, pkt: MailmanPacket): Promise<MailmanPacket> {
      if (i <= index) {
        return Promise.reject(new Error("next() called multiple times"));
      }
      index = i;

      if (i === middleware.length) {
        // All middleware exhausted — call the core handler
        return core(pkt);
      }

      const fn = middleware[i];
      return fn(pkt, () => step(i + 1, pkt));
    }

    return step(0, packet);
  };
}
