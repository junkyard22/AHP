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
import { MiddlewareFn, composeMiddleware } from "./middleware";
import { DeadLetterQueue } from "./dlq";
import {
  RetryPolicy,
  DEFAULT_RETRY_POLICY,
  withRetry,
} from "./retry";
import { DEFAULT_DB_PATH } from "./db";
import { newPacketId } from "../utils/ids";
import { now } from "../utils/time";

// ─────────────────────────────────────────────
//  Runtime config
// ─────────────────────────────────────────────

export interface RuntimeConfig {
  /**
   * Path to the SQLite database file.
   * Defaults to ~/.mailman/traces.db so traces persist across restarts.
   * Pass ':memory:' for ephemeral / test usage.
   */
  dbPath?: string;

  /**
   * Retry policy for handler failures.
   * Merged with DEFAULT_RETRY_POLICY so you only need to override what you want.
   */
  retry?: Partial<RetryPolicy>;
}

// ─────────────────────────────────────────────
//  Runtime stats
// ─────────────────────────────────────────────

interface RuntimeStats {
  packetsProcessed: number;
  packetsFailed: number;
  packetsRetried: number;
  packetsDeadLettered: number;
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
  private readonly dlq: DeadLetterQueue;
  private readonly middleware: MiddlewareFn[] = [];
  private readonly retryPolicy: RetryPolicy;

  private running = false;
  private stats: RuntimeStats = {
    packetsProcessed: 0,
    packetsFailed: 0,
    packetsRetried: 0,
    packetsDeadLettered: 0,
    startedAt: null,
  };

  constructor(config: RuntimeConfig = {}) {
    const dbPath = config.dbPath ?? DEFAULT_DB_PATH;
    this.registry = new Registry();
    this.router = new Router(this.registry);
    this.traceStore = new TraceStore(dbPath);
    this.dlq = new DeadLetterQueue(dbPath);
    this.validator = new Validator(this.registry);
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...(config.retry ?? {}) };
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

  // ── Middleware ────────────────────────────

  /**
   * Register a middleware function. Middleware runs in insertion order,
   * wrapping the core dispatch. Useful for logging, auth, metrics, etc.
   *
   * @example
   * runtime.use(async (packet, next) => {
   *   console.log("→", packet.type);
   *   const reply = await next();
   *   console.log("←", reply.type);
   *   return reply;
   * });
   */
  use(fn: MiddlewareFn): this {
    this.middleware.push(fn);
    return this;
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

    // 5. call handler (through middleware chain) with retry
    this.traceStore.record(packetId, taskId, "handler.started", packet.target);

    const coreDispatch = (pkt: MailmanPacket) => this.router.dispatch(pkt);
    const pipeline = composeMiddleware(this.middleware, coreDispatch);

    // Determine effective retry policy (packet-level override possible via meta)
    const retryPolicy: RetryPolicy = {
      ...this.retryPolicy,
    };

    let response: MailmanPacket;

    const outcome = await withRetry(
      () => {
        const timeoutMs = packet.meta?.timeoutMs;
        if (timeoutMs && timeoutMs > 0) {
          return this.withTimeout(pipeline(packet), timeoutMs, packet);
        }
        return pipeline(packet);
      },
      retryPolicy
    );

    if (!outcome.ok) {
      const err = outcome.error;
      const msg = err.message ?? "Handler threw an unknown error";
      const code =
        err instanceof MailmanError ? err.code : ErrorCode.HANDLER_THREW;

      const attempts = outcome.attempts;

      // Track retries in stats
      if (attempts > 1) {
        this.stats.packetsRetried += attempts - 1;
      }

      this.traceStore.record(packetId, taskId, "handler.threw", packet.target, {
        error: msg,
        code,
        attempts,
      });

      // Push to DLQ after exhausting retries
      this.dlq.push(packet, msg, attempts);
      this.stats.packetsDeadLettered++;

      this.traceStore.record(packetId, taskId, "packet.failed", "mailman", {
        deadLettered: true,
        attempts,
      });

      this.stats.packetsFailed++;
      return this.buildErrorPacket(packet, code, msg, { attempts });
    }

    response = outcome.result;

    if (outcome.attempts > 1) {
      this.stats.packetsRetried += outcome.attempts - 1;
      this.traceStore.record(
        packetId,
        taskId,
        "handler.finished",
        packet.target,
        { attempts: outcome.attempts }
      );
    } else {
      this.traceStore.record(packetId, taskId, "handler.finished", packet.target);
    }

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

  // ── DLQ access ────────────────────────────

  getDLQ() {
    return this.dlq;
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

export function getRuntime(config?: RuntimeConfig): Runtime {
  if (!_instance) {
    _instance = new Runtime(config);
  }
  return _instance;
}

export function resetRuntime(): void {
  _instance = null;
}
