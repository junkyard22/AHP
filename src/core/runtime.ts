import {
  MailmanPacket,
  MailmanRoleRegistration,
  MailmanTraceEntry,
  MailmanTraceEvent,
  PacketHandler,
  StreamHandler,
} from "../packet/types";
import { Registry } from "./registry";
import { Router } from "./router";
import { TraceStore } from "./traceStore";
import { Validator } from "./validator";
import { ErrorCode, MailmanError } from "./errors";
import { MiddlewareFn, composeMiddleware } from "./middleware";
import { DeadLetterQueue } from "./dlq";
import { RetryPolicy, DEFAULT_RETRY_POLICY, withRetry } from "./retry";
import { DEFAULT_DB_PATH } from "./db";
import { EventBus } from "./eventBus";
import { StreamSession, StreamSessionStore } from "./streamSession";
import { LoadBalancer, BalanceStrategy } from "./loadBalancer";
import { PacketScheduler, ScheduledEntry } from "./scheduler";
import { ITraceStore, IDLQStore } from "./backends";
import { newPacketId, newId } from "../utils/ids";
import { now } from "../utils/time";

// ─────────────────────────────────────────────
//  Telemetry hook
// ─────────────────────────────────────────────

export type TelemetryEvent = {
  type: MailmanTraceEvent;
  packetId: string;
  taskId: string;
  actor: string;
  timestamp: string;
  details?: Record<string, unknown>;
};

export type TelemetryHook = (event: TelemetryEvent) => void;

// ─────────────────────────────────────────────
//  Runtime config
// ─────────────────────────────────────────────

export interface RuntimeConfig {
  /**
   * Path to the SQLite database file.
   * Defaults to ~/.mailman/traces.db so traces persist across restarts.
   * Pass ':memory:' for ephemeral / test usage.
   * Ignored when custom traceStore / dlq are provided.
   */
  dbPath?: string;

  /** Retry policy for handler failures. Merged with DEFAULT_RETRY_POLICY. */
  retry?: Partial<RetryPolicy>;

  /**
   * Pluggable trace backend. Defaults to SQLite TraceStore.
   * Pass a MemoryTraceStore for tests, or your own implementation.
   */
  traceStore?: ITraceStore;

  /**
   * Pluggable dead-letter queue backend. Defaults to SQLite DeadLetterQueue.
   */
  dlq?: IDLQStore;

  /**
   * Called on every internal trace event — connect to OpenTelemetry,
   * Prometheus, Datadog, or any observability pipeline.
   */
  onTelemetry?: TelemetryHook;

  /**
   * Pre-register custom packet types at construction time.
   * You can also call runtime.registerPacketType() later.
   */
  customTypes?: string[];
}

// ─────────────────────────────────────────────
//  Runtime stats
// ─────────────────────────────────────────────

interface RuntimeStats {
  packetsProcessed: number;
  packetsFailed: number;
  packetsRetried: number;
  packetsDeadLettered: number;
  packetsDispatched: number;
  packetsPublished: number;
  startedAt: string | null;
}

// ─────────────────────────────────────────────
//  Pending ack channels (for sendWithAck)
// ─────────────────────────────────────────────

interface PendingAck {
  resolve: (packet: MailmanPacket) => void;
  reject: (err: Error) => void;
}

// ─────────────────────────────────────────────
//  Runtime
// ─────────────────────────────────────────────

export class Runtime {
  private readonly registry: Registry;
  private readonly router: Router;
  private readonly traceStore: ITraceStore;
  private readonly dlq: IDLQStore;
  private readonly validator: Validator;
  private readonly middleware: MiddlewareFn[] = [];
  private readonly retryPolicy: RetryPolicy;
  private readonly customTypes: Set<string>;

  // Item 2 — Pub/Sub
  private readonly eventBus: EventBus;

  // Item 4 — Streaming
  private readonly streamSessions: StreamSessionStore;

  // Item 6 — Load balancing
  private readonly loadBalancer: LoadBalancer;

  // Item 8 — Scheduling
  private readonly scheduler: PacketScheduler;

  // Item 7 — Ack/nack
  private readonly pendingAcks = new Map<string, PendingAck>();

  // Item 9 — Telemetry
  private readonly telemetryHook?: TelemetryHook;

  private running = false;
  private stats: RuntimeStats = {
    packetsProcessed: 0,
    packetsFailed: 0,
    packetsRetried: 0,
    packetsDeadLettered: 0,
    packetsDispatched: 0,
    packetsPublished: 0,
    startedAt: null,
  };

  constructor(config: RuntimeConfig = {}) {
    const dbPath = config.dbPath ?? DEFAULT_DB_PATH;

    this.registry     = new Registry();
    this.router       = new Router(this.registry);
    this.traceStore   = config.traceStore ?? new TraceStore(dbPath);
    this.dlq          = config.dlq        ?? new DeadLetterQueue(dbPath);
    this.customTypes  = new Set(config.customTypes ?? []);
    this.validator    = new Validator(this.registry, this.customTypes);
    this.retryPolicy  = { ...DEFAULT_RETRY_POLICY, ...(config.retry ?? {}) };
    this.telemetryHook = config.onTelemetry;

    this.eventBus      = new EventBus();
    this.streamSessions = new StreamSessionStore();
    this.loadBalancer  = new LoadBalancer();
    this.scheduler     = new PacketScheduler((pkt) => this.dispatch(pkt));
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

  // ── Item 1: Custom packet type registration ──

  /**
   * Register a user-defined packet type so the validator accepts it.
   * Use dot-notation namespacing: "myapp.event", "agent.thought", etc.
   */
  registerPacketType(type: string): this {
    this.customTypes.add(type);
    return this;
  }

  /** Returns all currently known types (built-in + custom). */
  registeredTypes(): string[] {
    const { BUILTIN_PACKET_TYPES } = require("../packet/types");
    return [...BUILTIN_PACKET_TYPES, ...this.customTypes];
  }

  // ── Core: send ────────────────────────────

  async send(packet: MailmanPacket): Promise<MailmanPacket> {
    const { packetId, taskId, sender } = packet;

    this.record(packetId, taskId, "packet.received", sender);

    const result = this.validator.validate(packet);

    if (!result.ok) {
      this.record(packetId, taskId, "packet.rejected", "mailman", {
        reason: result.message,
        code: result.code,
      });
      this.stats.packetsFailed++;
      return this.buildErrorPacket(packet, result.code, result.message);
    }

    this.record(packetId, taskId, "packet.validated", "mailman");
    this.record(packetId, taskId, "packet.routed",    "mailman", { target: packet.target });
    this.record(packetId, taskId, "packet.delivered", "mailman", { target: packet.target });
    this.record(packetId, taskId, "handler.started",  packet.target);

    const coreDispatch = (pkt: MailmanPacket) => this.router.dispatch(pkt);
    const pipeline = composeMiddleware(this.middleware, coreDispatch);

    const retryPolicy: RetryPolicy = { ...this.retryPolicy };

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
      const code = err instanceof MailmanError ? err.code : ErrorCode.HANDLER_THREW;
      const attempts = outcome.attempts;

      if (attempts > 1) this.stats.packetsRetried += attempts - 1;

      this.record(packetId, taskId, "handler.threw", packet.target, { error: msg, code, attempts });
      this.dlq.push(packet, msg, attempts);
      this.stats.packetsDeadLettered++;

      this.record(packetId, taskId, "packet.failed", "mailman", { deadLettered: true, attempts });
      this.stats.packetsFailed++;
      return this.buildErrorPacket(packet, code, msg, { attempts });
    }

    const response = outcome.result;

    if (outcome.attempts > 1) {
      this.stats.packetsRetried += outcome.attempts - 1;
      this.record(packetId, taskId, "handler.finished", packet.target, { attempts: outcome.attempts });
    } else {
      this.record(packetId, taskId, "handler.finished", packet.target);
    }

    this.record(packetId, taskId, "packet.completed", "mailman");
    this.stats.packetsProcessed++;

    // Track ack/nack for sendWithAck
    if (response.type === "task.ack") {
      this.record(packetId, taskId, "packet.acked", "mailman");
    } else if (response.type === "task.nack") {
      this.record(packetId, taskId, "packet.nacked", "mailman");
      // Reject any waiting ack result promise
      const pending = this.pendingAcks.get(taskId);
      if (pending) {
        pending.reject(new MailmanError(ErrorCode.HANDLER_THREW, response.error?.message ?? "Handler nacked"));
        this.pendingAcks.delete(taskId);
      }
    }

    // Fan out to pub/sub subscribers
    this.eventBus.publish(response);

    return response;
  }

  // ── Item 2: Fire-and-forget dispatch ──────

  /**
   * Send a packet without waiting for a reply.
   * Validation and routing still run; errors are traced + dead-lettered.
   */
  dispatch(packet: MailmanPacket): void {
    this.record(packet.packetId, packet.taskId, "packet.dispatched", packet.sender);
    this.stats.packetsDispatched++;
    this.send(packet).catch(() => {
      // errors already traced and dead-lettered inside send()
    });
  }

  // ── Item 2: Pub/Sub ───────────────────────

  /**
   * Subscribe to packets by type pattern.
   * Topics: exact type, "task.*", or "*" for all.
   * Returns an unsubscribe function.
   */
  subscribe(topic: string, handler: (packet: MailmanPacket) => void): () => void {
    return this.eventBus.subscribe(topic, handler);
  }

  /**
   * Publish a packet directly to all matching subscribers.
   * No validation, no routing, no reply — pure event fan-out.
   */
  publish(packet: MailmanPacket): void {
    this.record(packet.packetId, packet.taskId, "packet.published", packet.sender);
    this.stats.packetsPublished++;
    this.eventBus.publish(packet);
  }

  // ── Item 4: Streaming ─────────────────────

  /**
   * Register a role that produces a stream of chunks instead of a single reply.
   * The handler calls stream.push(chunk), stream.end(), or stream.error().
   *
   * @example
   * runtime.registerStreamRole(
   *   { name: "llm", accepts: ["stream.open"], capabilities: ["generate"] },
   *   async (packet, stream) => {
   *     for await (const token of llm.stream(packet.payload.prompt as string)) {
   *       stream.push(token);
   *     }
   *     stream.end();
   *   }
   * );
   */
  registerStreamRole(role: MailmanRoleRegistration, handler: StreamHandler): void {
    const wrappedHandler: PacketHandler = async (packet) => {
      const streamId = packet.meta?.streamId;
      if (!streamId) {
        throw new MailmanError(ErrorCode.STREAM_NOT_FOUND, "No streamId in packet meta");
      }

      const session = this.streamSessions.get(streamId);
      if (!session) {
        throw new MailmanError(ErrorCode.STREAM_NOT_FOUND, `Stream session not found: ${streamId}`);
      }

      // Run stream handler asynchronously — don't block send()
      handler(packet, session).then(() => {
        if (!session.isEnded) session.end();
        this.record(packet.packetId, packet.taskId, "stream.closed", role.name, { streamId });
        this.streamSessions.delete(streamId);
      }).catch((err: Error) => {
        session.error(err);
        this.record(packet.packetId, packet.taskId, "stream.errored", role.name, {
          streamId,
          error: err.message,
        });
        this.streamSessions.delete(streamId);
      });

      // Return an immediate ack so send() can complete
      return {
        packetId:  newPacketId(),
        taskId:    packet.taskId,
        parentPacketId: packet.packetId,
        type:      "task.ack" as const,
        sender:    role.name,
        target:    packet.sender,
        timestamp: now(),
        payload:   { streaming: true, streamId },
      };
    };

    this.registry.register(role, wrappedHandler);
  }

  /**
   * Open a streaming session to a registered stream role.
   * Returns an AsyncIterable<string> that yields chunks as they arrive.
   *
   * @example
   * const chunks = await runtime.openStream({
   *   packetId: newPacketId(), taskId: newTaskId(),
   *   type: "stream.open", sender: "me", target: "llm",
   *   payload: { prompt: "Tell me a story" }, timestamp: now(),
   * });
   * for await (const chunk of chunks) process.stdout.write(chunk);
   */
  async openStream(packet: MailmanPacket): Promise<AsyncIterable<string>> {
    const streamId = newId("stream");
    const session  = this.streamSessions.create(streamId);

    const augmented: MailmanPacket = {
      ...packet,
      meta: { ...packet.meta, streamId },
    };

    this.record(packet.packetId, packet.taskId, "stream.opened", packet.sender, { streamId });

    const ack = await this.send(augmented);

    if (ack.type === "error.report") {
      session.error(new Error(ack.error?.message ?? "Stream open failed"));
      this.streamSessions.delete(streamId);
    }

    return session;
  }

  // ── Item 6: Capability routing ────────────

  /**
   * Send a packet to any registered role that advertises the given capability.
   * Use strategy to control which role is picked when multiple qualify.
   *
   * @example
   * const result = await runtime.sendToCapability("summarize", packet);
   * const result = await runtime.sendToCapability("translate", packet, "least-loaded");
   */
  async sendToCapability(
    capability: string,
    packet: MailmanPacket,
    strategy: BalanceStrategy = "round-robin"
  ): Promise<MailmanPacket> {
    const candidates = this.registry
      .findByCapability(capability)
      .map((e) => e.registration.name);

    if (candidates.length === 0) {
      this.stats.packetsFailed++;
      return this.buildErrorPacket(
        packet,
        ErrorCode.NO_CAPABLE_ROLE,
        `No registered role has capability "${capability}"`
      );
    }

    const chosen = this.loadBalancer.pick(candidates, strategy)!;
    const routed: MailmanPacket = { ...packet, target: chosen };

    this.loadBalancer.recordStart(chosen);
    try {
      const reply = await this.send(routed);
      return reply;
    } finally {
      this.loadBalancer.recordEnd(chosen);
    }
  }

  // ── Item 7: Ack/nack ──────────────────────

  /**
   * Send a packet and receive two separate promises:
   *   - ack:    resolves when the handler acknowledges receipt (task.ack)
   *   - result: resolves when the handler calls runtime.deliverResult()
   *
   * The handler should return task.ack immediately and later call:
   *   runtime.deliverResult(packet.taskId, resultPacket)
   *
   * @example
   * const { ack, result } = await runtime.sendWithAck(packet);
   * console.log("acknowledged:", ack.type);  // "task.ack"
   * const final = await result;              // arrives asynchronously
   */
  async sendWithAck(packet: MailmanPacket): Promise<{
    ack: MailmanPacket;
    result: Promise<MailmanPacket>;
  }> {
    const resultPromise = new Promise<MailmanPacket>((resolve, reject) => {
      this.pendingAcks.set(packet.taskId, { resolve, reject });
    });

    const augmented: MailmanPacket = {
      ...packet,
      meta: { ...packet.meta, ackRequired: true },
    };

    const ack = await this.send(augmented);

    // If the send itself failed, reject the result promise
    if (ack.type === "error.report" || ack.type === "task.nack") {
      const pending = this.pendingAcks.get(packet.taskId);
      if (pending) {
        pending.reject(
          new MailmanError(
            ErrorCode.HANDLER_THREW,
            ack.error?.message ?? "Handler rejected the packet"
          )
        );
        this.pendingAcks.delete(packet.taskId);
      }
    }

    return { ack, result: resultPromise };
  }

  /**
   * Deliver the final result for a task that was sent with sendWithAck().
   * Call this from inside the handler after async processing is done.
   *
   * @param taskId  The original packet's taskId.
   * @param result  The final result packet to resolve the pending promise.
   */
  deliverResult(taskId: string, result: MailmanPacket): void {
    const pending = this.pendingAcks.get(taskId);
    if (!pending) return;
    pending.resolve(result);
    this.pendingAcks.delete(taskId);
    this.record(result.packetId, taskId, "packet.completed", "mailman", {
      via: "deliverResult",
    });
  }

  // ── Item 8: Scheduling ────────────────────

  /**
   * Schedule a packet for delivery at a specific date/time.
   * Returns a scheduleId for cancellation.
   */
  schedulePacket(packet: MailmanPacket, deliverAt: Date): string {
    const id = this.scheduler.schedule(packet, deliverAt);
    this.record(packet.packetId, packet.taskId, "packet.scheduled", "mailman", {
      scheduleId: id,
      deliverAt: deliverAt.toISOString(),
    });
    return id;
  }

  /**
   * Schedule a packet for delivery after a delay.
   * Returns a scheduleId for cancellation.
   */
  scheduleAfter(packet: MailmanPacket, delayMs: number): string {
    const id = this.scheduler.scheduleAfter(packet, delayMs);
    this.record(packet.packetId, packet.taskId, "packet.scheduled", "mailman", {
      scheduleId: id,
      delayMs,
    });
    return id;
  }

  /**
   * Schedule a packet to be delivered repeatedly.
   * Returns a scheduleId — pass to cancelScheduled() to stop.
   */
  scheduleRecurring(
    packet: MailmanPacket,
    intervalMs: number,
    startAt?: Date
  ): string {
    const id = this.scheduler.scheduleRecurring(packet, intervalMs, startAt);
    this.record(packet.packetId, packet.taskId, "packet.scheduled", "mailman", {
      scheduleId: id,
      intervalMs,
      recurring: true,
    });
    return id;
  }

  /** Cancel a scheduled or recurring packet. Returns true if found. */
  cancelScheduled(scheduleId: string): boolean {
    return this.scheduler.cancel(scheduleId);
  }

  /** All packets currently waiting to be delivered. */
  listScheduled(): ScheduledEntry[] {
    return this.scheduler.listPending();
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

  getDLQ(): IDLQStore {
    return this.dlq;
  }

  // ── Stats ─────────────────────────────────

  getStats(): RuntimeStats {
    return { ...this.stats };
  }

  // ── Internal helpers ──────────────────────

  /** Unified trace record — calls traceStore and fires telemetry hook. */
  private record(
    packetId: string,
    taskId: string,
    event: MailmanTraceEvent,
    actor: string,
    details?: Record<string, unknown>
  ): void {
    this.traceStore.record(packetId, taskId, event, actor, details);

    if (this.telemetryHook) {
      try {
        this.telemetryHook({ type: event, packetId, taskId, actor, timestamp: now(), details });
      } catch {
        // hooks must not crash the runtime
      }
    }
  }

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
        .then((r) => { clearTimeout(timer); resolve(r); })
        .catch((e) => { clearTimeout(timer); reject(e);  });
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
