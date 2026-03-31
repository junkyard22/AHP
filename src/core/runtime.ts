import {
  MailmanPacket,
  MailmanRoleRegistration,
  MailmanTraceEntry,
  PacketHandler,
} from "../packet/types";
import { Registry } from "./registry";
import { Router } from "./router";
import { TraceStore } from "./traceStore";
import { Validator } from "./validator";
import { ErrorCode, MailmanError } from "./errors";
import { newPacketId } from "../utils/ids";
import { now } from "../utils/time";

// ─────────────────────────────────────────────
//  Runtime state
// ─────────────────────────────────────────────

interface RuntimeStats {
  packetsProcessed: number;
  packetsFailed: number;
  startedAt: string | null;
}

// ─────────────────────────────────────────────
//  Runtime
// ─────────────────────────────────────────────

export class Runtime {
  private readonly registry: Registry;
  private readonly router: Router;
  private readonly traceStore: TraceStore;
  private readonly validator: Validator;

  private running = false;
  private stats: RuntimeStats = {
    packetsProcessed: 0,
    packetsFailed: 0,
    startedAt: null,
  };

  constructor() {
    this.registry = new Registry();
    this.router = new Router(this.registry);
    this.traceStore = new TraceStore();
    this.validator = new Validator(this.registry);
  }

  // ── Lifecycle ─────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stats.startedAt = now();
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Role management ───────────────────────

  registerRole(role: MailmanRoleRegistration, handler: PacketHandler): void {
    this.registry.register(role, handler);
  }

  unregisterRole(name: string): void {
    this.registry.unregister(name);
  }

  listRoles(): MailmanRoleRegistration[] {
    return this.registry.list();
  }

  // ── Core: send ────────────────────────────

  async send(packet: MailmanPacket): Promise<MailmanPacket> {
    const { packetId, taskId, sender } = packet;

    // 1. received
    this.traceStore.record(packetId, taskId, "packet.received", sender);

    // 2. validate
    const result = this.validator.validate(packet);

    if (!result.ok) {
      this.traceStore.record(packetId, taskId, "packet.rejected", "mailman", {
        reason: result.message,
        code: result.code,
      });

      this.stats.packetsFailed++;
      return this.buildErrorPacket(packet, result.code, result.message);
    }

    this.traceStore.record(packetId, taskId, "packet.validated", "mailman");

    // 3. route
    this.traceStore.record(packetId, taskId, "packet.routed", "mailman", {
      target: packet.target,
    });

    // 4. deliver
    this.traceStore.record(packetId, taskId, "packet.delivered", "mailman", {
      target: packet.target,
    });

    // 5. call handler
    this.traceStore.record(packetId, taskId, "handler.started", packet.target);

    let response: MailmanPacket;

    try {
      // Respect optional timeout
      const timeoutMs = packet.meta?.timeoutMs;
      if (timeoutMs && timeoutMs > 0) {
        response = await this.withTimeout(
          this.router.dispatch(packet),
          timeoutMs,
          packet
        );
      } else {
        response = await this.router.dispatch(packet);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Handler threw an unknown error";
      const code =
        err instanceof MailmanError ? err.code : ErrorCode.HANDLER_THREW;

      this.traceStore.record(packetId, taskId, "handler.threw", packet.target, {
        error: msg,
        code,
      });

      this.traceStore.record(packetId, taskId, "packet.failed", "mailman");
      this.stats.packetsFailed++;

      return this.buildErrorPacket(packet, code, msg);
    }

    // 6. completed
    this.traceStore.record(packetId, taskId, "handler.finished", packet.target);
    this.traceStore.record(packetId, taskId, "packet.completed", "mailman");
    this.stats.packetsProcessed++;

    return response;
  }

  // ── Ping ─────────────────────────────────

  async ping(roleName: string): Promise<boolean> {
    const entry = this.registry.get(roleName);
    if (!entry) return false;
    if (!entry.registration.accepts.includes("health.ping")) return false;

    const pingPacket: MailmanPacket = {
      packetId: newPacketId(),
      taskId: "ping",
      type: "health.ping",
      sender: "mailman",
      target: roleName,
      timestamp: now(),
      payload: {},
    };

    try {
      const pong = await this.router.dispatch(pingPacket);
      return pong.type === "health.pong";
    } catch {
      return false;
    }
  }

  // ── Trace access ──────────────────────────

  getTrace(packetId: string): MailmanTraceEntry[] {
    return this.traceStore.getByPacket(packetId);
  }

  getTaskTrace(taskId: string): MailmanTraceEntry[] {
    return this.traceStore.getByTask(taskId);
  }

  allTraces(): MailmanTraceEntry[] {
    return this.traceStore.all();
  }

  // ── Stats ─────────────────────────────────

  getStats(): RuntimeStats {
    return { ...this.stats };
  }

  // ── Internal helpers ──────────────────────

  private buildErrorPacket(
    original: MailmanPacket,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ): MailmanPacket {
    return {
      packetId: newPacketId(),
      taskId: original.taskId,
      parentPacketId: original.packetId,
      type: "error.report",
      sender: "mailman",
      target: original.sender,
      timestamp: now(),
      payload: {},
      status: "failed",
      error: { code, message, details },
    };
  }

  private withTimeout(
    promise: Promise<MailmanPacket>,
    ms: number,
    original: MailmanPacket
  ): Promise<MailmanPacket> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new MailmanError(
            ErrorCode.HANDLER_TIMEOUT,
            `Handler for "${original.target}" timed out after ${ms}ms`
          )
        );
      }, ms);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}

// ─────────────────────────────────────────────
//  Singleton (for CLI / simple usage)
// ─────────────────────────────────────────────

let _instance: Runtime | null = null;

export function getRuntime(): Runtime {
  if (!_instance) {
    _instance = new Runtime();
  }
  return _instance;
}

export function resetRuntime(): void {
  _instance = null;
}
