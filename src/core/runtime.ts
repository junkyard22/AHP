import {
  MAILMAN_PROTOCOL_VERSION,
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
  PostmasterRuntimeEvent,
  PostmasterTroubleshootingReport,
  PostmasterTroubleshootingTarget,
  REPLY_LIKE_MESSAGE_TYPES,
} from "../packet/types";
import { normalizeMessage } from "../packet/createPacket";
import { Registry } from "./registry";
import { Router } from "./router";
import { TraceStore } from "./traceStore";
import { ObservationStore } from "./observationStore";
import { Validator } from "./validator";
import { ErrorCode, MailmanError } from "./errors";
import { elapsedMs, now } from "../utils/time";
import { newId, newMessageId } from "../utils/ids";

// ─────────────────────────────────────────────
//  Runtime state
// ─────────────────────────────────────────────

export interface PostmasterStats {
  messagesProcessed: number;
  messagesFailed: number;
  packetsProcessed: number;
  packetsFailed: number;
  observationsRecorded: number;
  slowMessages: number;
  startedAt: string | null;
}

export interface PostmasterOptions {
  slowMessageThresholdMs?: number;
}

// ─────────────────────────────────────────────
//  Postmaster
// ─────────────────────────────────────────────

export class Postmaster {
  private readonly registry: Registry;
  private readonly router: Router;
  private readonly traceStore: TraceStore;
  private readonly observationStore: ObservationStore;
  private readonly validator: Validator;
  private readonly observers = new Map<string, PostmasterObserver>();
  private readonly slowMessageThresholdMs: number;

  private running = false;
  private stats: PostmasterStats = {
    messagesProcessed: 0,
    messagesFailed: 0,
    packetsProcessed: 0,
    packetsFailed: 0,
    observationsRecorded: 0,
    slowMessages: 0,
    startedAt: null,
  };

  constructor(options: PostmasterOptions = {}) {
    this.registry = new Registry();
    this.router = new Router(this.registry);
    this.traceStore = new TraceStore();
    this.observationStore = new ObservationStore();
    this.validator = new Validator(this.registry);
    this.slowMessageThresholdMs = options.slowMessageThresholdMs ?? 750;
  }

  // ── Lifecycle ─────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stats.startedAt = now();

    void this.emitRuntimeEvent({
      type: "runtime.started",
      stage: "runtime",
      actor: "postmaster",
      details: {
        slowMessageThresholdMs: this.slowMessageThresholdMs,
      },
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    void this.emitRuntimeEvent({
      type: "runtime.stopped",
      stage: "runtime",
      actor: "postmaster",
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Agent management ──────────────────────

  registerAgent(agent: MailmanAgentRegistration, handler: MessageHandler): void {
    this.registry.registerAgent(agent, handler);
  }

  unregisterAgent(name: string): void {
    this.registry.unregisterAgent(name);
  }

  listAgents(): MailmanAgentRegistration[] {
    return this.registry.listAgents();
  }

  registerRole(role: MailmanRoleRegistration, handler: PacketHandler): void {
    this.registerAgent(role, handler);
  }

  unregisterRole(name: string): void {
    this.unregisterAgent(name);
  }

  listRoles(): MailmanRoleRegistration[] {
    return this.listAgents();
  }

  // ── Observation ───────────────────────────

  registerObserver(observer: PostmasterObserver): void {
    const name = observer.registration.name;
    if (this.observers.has(name)) {
      throw new MailmanError(
        ErrorCode.OBSERVER_ALREADY_REGISTERED,
        `Observer already registered: ${name}`
      );
    }

    this.observers.set(name, observer);
  }

  unregisterObserver(name: string): void {
    if (!this.observers.has(name)) {
      throw new MailmanError(
        ErrorCode.OBSERVER_NOT_FOUND,
        `Observer not found: ${name}`
      );
    }

    this.observers.delete(name);
  }

  listObservers(): PostmasterObserverRegistration[] {
    return Array.from(this.observers.values()).map((observer) => ({
      ...observer.registration,
      events: observer.registration.events
        ? [...observer.registration.events]
        : undefined,
      stages: observer.registration.stages
        ? [...observer.registration.stages]
        : undefined,
    }));
  }

  getMessageObservations(messageId: string): PostmasterObservation[] {
    return this.observationStore.getByMessage(messageId);
  }

  getConversationObservations(conversationId: string): PostmasterObservation[] {
    return this.observationStore.getByConversation(conversationId);
  }

  allObservations(): PostmasterObservation[] {
    return this.observationStore.all();
  }

  createTroubleshootingReport(
    target: PostmasterTroubleshootingTarget
  ): PostmasterTroubleshootingReport {
    let traces: MailmanTraceEntry[];
    let observations: PostmasterObservation[];

    if (target.messageId) {
      traces = this.getMessageTrace(target.messageId);
      observations = this.getMessageObservations(target.messageId);
    } else if (target.conversationId) {
      traces = this.getConversationTrace(target.conversationId);
      observations = this.getConversationObservations(target.conversationId);
    } else {
      traces = this.allTraces();
      observations = this.allObservations();
    }

    const participantSet = new Set<string>();
    const messageSet = new Set<string>();

    for (const trace of traces) {
      participantSet.add(trace.actor);
      messageSet.add(trace.messageId);
    }

    for (const observation of observations) {
      participantSet.add(observation.actor);
      messageSet.add(observation.messageId);
    }

    const warningCount = observations.filter(
      (observation) => observation.severity === "warning"
    ).length;
    const errorCount = observations.filter(
      (observation) => observation.severity === "error"
    ).length;

    const status =
      errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "healthy";

    return {
      generatedAt: now(),
      scope: { ...target },
      status,
      summary: {
        totalMessages: messageSet.size,
        totalTraces: traces.length,
        totalObservations: observations.length,
        warningCount,
        errorCount,
        participants: Array.from(participantSet),
      },
      traces,
      observations,
    };
  }

  // ── Core: send ────────────────────────────

  async send(packet: MailmanPacket): Promise<MailmanMessage> {
    const message = normalizeMessage(packet);
    const startedAt = now();
    const { messageId, conversationId, sender } = message;

    this.traceStore.record(messageId, conversationId, "message.received", sender);
    await this.emitRuntimeEvent({
      type: "message.received",
      stage: "ingress",
      actor: sender,
      message,
    });

    this.observeIngress(message);

    if (!this.running) {
      this.traceStore.record(
        messageId,
        conversationId,
        "message.failed",
        "postmaster",
        {
          code: ErrorCode.RUNTIME_NOT_STARTED,
        }
      );

      await this.emitRuntimeEvent({
        type: "message.failed",
        stage: "runtime",
        actor: "postmaster",
        message,
        error: {
          code: ErrorCode.RUNTIME_NOT_STARTED,
          message: "Runtime is not started",
        },
      });

      this.recordObservation({
        messageId,
        conversationId,
        severity: "error",
        stage: "runtime",
        code: "runtime.not_started",
        summary: "Message rejected because Postmaster is not running.",
        actor: "postmaster",
      });
      this.incrementFailures();

      return this.buildErrorMessage(
        message,
        ErrorCode.RUNTIME_NOT_STARTED,
        "Runtime is not started"
      );
    }

    const result = this.validator.validate(message);

    if (!result.ok) {
      this.traceStore.record(messageId, conversationId, "message.rejected", "postmaster", {
        reason: result.message,
        code: result.code,
      });

      await this.emitRuntimeEvent({
        type: "message.rejected",
        stage: "validation",
        actor: "postmaster",
        message,
        error: {
          code: result.code,
          message: result.message,
        },
      });

      this.recordObservation({
        messageId,
        conversationId,
        severity: "error",
        stage: "validation",
        code: "validation.failed",
        summary: result.message,
        actor: "postmaster",
        details: {
          errorCode: result.code,
        },
      });
      this.incrementFailures();

      return this.buildErrorMessage(message, result.code, result.message);
    }

    this.traceStore.record(messageId, conversationId, "message.validated", "postmaster");
    await this.emitRuntimeEvent({
      type: "message.validated",
      stage: "validation",
      actor: "postmaster",
      message,
    });

    this.traceStore.record(messageId, conversationId, "message.routed", "postmaster", {
      target: message.target,
      type: message.type,
    });
    await this.emitRuntimeEvent({
      type: "message.routed",
      stage: "routing",
      actor: "postmaster",
      message,
      details: {
        target: message.target,
        type: message.type,
      },
    });

    this.traceStore.record(messageId, conversationId, "message.delivered", "postmaster", {
      target: message.target,
    });
    await this.emitRuntimeEvent({
      type: "message.delivered",
      stage: "delivery",
      actor: "postmaster",
      message,
      details: {
        target: message.target,
      },
    });

    this.traceStore.record(messageId, conversationId, "handler.started", message.target);
    await this.emitRuntimeEvent({
      type: "handler.started",
      stage: "handler",
      actor: message.target,
      message,
    });

    let rawResponse: MailmanMessage;

    try {
      const timeoutMs = message.meta?.timeoutMs;
      if (timeoutMs && timeoutMs > 0) {
        rawResponse = await this.withTimeout(
          this.router.dispatch(message),
          timeoutMs,
          message
        );
      } else {
        rawResponse = await this.router.dispatch(message);
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Handler threw an unknown error";
      const errorCode =
        err instanceof MailmanError ? err.code : ErrorCode.HANDLER_THREW;

      this.traceStore.record(messageId, conversationId, "handler.threw", message.target, {
        error: errorMessage,
        code: errorCode,
      });
      this.traceStore.record(messageId, conversationId, "message.failed", "postmaster");

      await this.emitRuntimeEvent({
        type: "handler.threw",
        stage: "handler",
        actor: message.target,
        message,
        error: {
          code: errorCode,
          message: errorMessage,
        },
      });
      await this.emitRuntimeEvent({
        type: "message.failed",
        stage: "handler",
        actor: "postmaster",
        message,
        error: {
          code: errorCode,
          message: errorMessage,
        },
      });

      this.recordObservation({
        messageId,
        conversationId,
        severity: "error",
        stage: "handler",
        code:
          errorCode === ErrorCode.HANDLER_TIMEOUT
            ? "handler.timeout"
            : "handler.failed",
        summary: errorMessage,
        actor: "postmaster",
        details: {
          errorCode,
          target: message.target,
        },
      });
      this.incrementFailures();

      return this.buildErrorMessage(message, errorCode, errorMessage);
    }

    const durationMs = elapsedMs(startedAt);
    const replyTo =
      rawResponse.replyTo ??
      rawResponse.parentPacketId ??
      (REPLY_LIKE_MESSAGE_TYPES.includes(rawResponse.type)
        ? message.messageId
        : undefined);

    const response = normalizeMessage({
      ...rawResponse,
      protocol: rawResponse.protocol ?? message.protocol,
      conversationId: rawResponse.conversationId ?? message.conversationId,
      taskId: rawResponse.taskId ?? message.taskId ?? message.conversationId,
      replyTo,
      parentPacketId: rawResponse.parentPacketId ?? replyTo,
    });

    this.observeResponse(message, rawResponse, response, durationMs);

    this.traceStore.record(messageId, conversationId, "handler.finished", message.target);
    await this.emitRuntimeEvent({
      type: "handler.finished",
      stage: "handler",
      actor: message.target,
      message,
      response,
      durationMs,
    });

    this.traceStore.record(messageId, conversationId, "message.completed", "postmaster");
    await this.emitRuntimeEvent({
      type: "message.completed",
      stage: "response",
      actor: "postmaster",
      message,
      response,
      durationMs,
    });

    this.incrementProcessed();

    return response;
  }

  // ── Ping ─────────────────────────────────

  async ping(agentName: string): Promise<boolean> {
    if (!this.running) return false;

    const entry = this.registry.get(agentName);
    if (!entry) return false;
    if (!entry.registration.accepts.includes("health.ping")) return false;

    const pingMessage: MailmanMessage = normalizeMessage({
      messageId: newMessageId(),
      conversationId: "ping",
      type: "health.ping",
      sender: "postmaster",
      target: agentName,
      timestamp: now(),
      payload: {},
    });

    try {
      const pong = await this.router.dispatch(pingMessage);
      return pong.type === "health.pong";
    } catch {
      return false;
    }
  }

  // ── Trace access ──────────────────────────

  getMessageTrace(messageId: string): MailmanTraceEntry[] {
    return this.traceStore.getByMessage(messageId);
  }

  getConversationTrace(conversationId: string): MailmanTraceEntry[] {
    return this.traceStore.getByConversation(conversationId);
  }

  getTrace(packetId: string): MailmanTraceEntry[] {
    return this.getMessageTrace(packetId);
  }

  getTaskTrace(taskId: string): MailmanTraceEntry[] {
    return this.getConversationTrace(taskId);
  }

  allTraces(): MailmanTraceEntry[] {
    return this.traceStore.all();
  }

  // ── Stats ─────────────────────────────────

  getStats(): PostmasterStats {
    return { ...this.stats };
  }

  // ── Internal helpers ──────────────────────

  private observeIngress(message: MailmanMessage): void {
    if (message.protocol === MAILMAN_PROTOCOL_VERSION) {
      this.recordObservation({
        messageId: message.messageId,
        conversationId: message.conversationId,
        severity: "warning",
        stage: "ingress",
        code: "protocol.legacy",
        summary:
          "Message is using the legacy Mailman protocol. Consider upgrading to Postmaster.",
        actor: "postmaster",
      });
    }
  }

  private observeResponse(
    original: MailmanMessage,
    rawResponse: MailmanMessage,
    response: MailmanMessage,
    durationMs: number
  ): void {
    if (
      REPLY_LIKE_MESSAGE_TYPES.includes(rawResponse.type) &&
      !rawResponse.replyTo &&
      !rawResponse.parentPacketId
    ) {
      this.recordObservation({
        messageId: original.messageId,
        conversationId: original.conversationId,
        severity: "warning",
        stage: "response",
        code: "response.reply_autofilled",
        summary:
          "Response omitted reply metadata, so Postmaster filled it in automatically.",
        actor: "postmaster",
        details: {
          responseType: rawResponse.type,
        },
      });
    }

    if (
      rawResponse.conversationId !== undefined &&
      rawResponse.conversationId !== original.conversationId
    ) {
      this.recordObservation({
        messageId: original.messageId,
        conversationId: original.conversationId,
        severity: "warning",
        stage: "response",
        code: "response.conversation_mismatch",
        summary:
          "Response tried to switch conversations and was normalized back to the request conversation.",
        actor: "postmaster",
        details: {
          requestedConversationId: original.conversationId,
          responseConversationId: rawResponse.conversationId,
        },
      });
    }

    if (
      rawResponse.protocol !== undefined &&
      rawResponse.protocol !== original.protocol
    ) {
      this.recordObservation({
        messageId: original.messageId,
        conversationId: original.conversationId,
        severity: "warning",
        stage: "response",
        code: "response.protocol_mismatch",
        summary:
          "Response used a different protocol version than the original message.",
        actor: "postmaster",
        details: {
          requestProtocol: original.protocol,
          responseProtocol: rawResponse.protocol,
        },
      });
    }

    if (
      original.meta?.replyRequired &&
      !REPLY_LIKE_MESSAGE_TYPES.includes(response.type)
    ) {
      this.recordObservation({
        messageId: original.messageId,
        conversationId: original.conversationId,
        severity: "warning",
        stage: "response",
        code: "response.non_reply_type",
        summary:
          "Message requested a reply, but the handler returned a non-reply message type.",
        actor: "postmaster",
        details: {
          responseType: response.type,
        },
      });
    }

    if (response.sender !== original.target) {
      this.recordObservation({
        messageId: original.messageId,
        conversationId: original.conversationId,
        severity: "warning",
        stage: "response",
        code: "response.sender_unexpected",
        summary:
          "Response sender does not match the agent that handled the message.",
        actor: "postmaster",
        details: {
          expectedSender: original.target,
          actualSender: response.sender,
        },
      });
    }

    if (durationMs > this.slowMessageThresholdMs) {
      this.stats.slowMessages++;
      this.recordObservation({
        messageId: original.messageId,
        conversationId: original.conversationId,
        severity: "warning",
        stage: "handler",
        code: "handler.slow",
        summary: `Handler took ${durationMs}ms, which is slower than the ${this.slowMessageThresholdMs}ms threshold.`,
        actor: "postmaster",
        details: {
          durationMs,
          thresholdMs: this.slowMessageThresholdMs,
          target: original.target,
        },
      });
    }

    if (response.type === "agent.error" || response.type === "error.report") {
      this.recordObservation({
        messageId: original.messageId,
        conversationId: original.conversationId,
        severity: "error",
        stage: "response",
        code: "response.error",
        summary: response.error?.message ?? "Handler returned an error response.",
        actor: "postmaster",
        details: {
          responseType: response.type,
          errorCode: response.error?.code,
        },
      });
    }
  }

  private recordObservation(
    observation: Omit<PostmasterObservation, "observationId" | "timestamp">
  ): PostmasterObservation {
    const recorded = this.observationStore.record(observation);
    this.stats.observationsRecorded++;
    return recorded;
  }

  private async emitRuntimeEvent(
    event: Omit<PostmasterRuntimeEvent, "eventId" | "timestamp">
  ): Promise<void> {
    const fullEvent: PostmasterRuntimeEvent = {
      ...event,
      eventId: newId("evt"),
      timestamp: now(),
    };

    for (const observer of this.observers.values()) {
      const wantsEvent =
        !observer.registration.events ||
        observer.registration.events.includes(fullEvent.type);
      const wantsStage =
        !observer.registration.stages ||
        observer.registration.stages.includes(fullEvent.stage);

      if (!wantsEvent || !wantsStage) continue;

      try {
        await observer.onEvent(fullEvent);
      } catch (err: unknown) {
        if (!fullEvent.message) continue;

        this.recordObservation({
          messageId: fullEvent.message.messageId,
          conversationId: fullEvent.message.conversationId,
          severity: "warning",
          stage: "runtime",
          code: "observer.failed",
          summary: `Observer "${observer.registration.name}" threw while handling ${fullEvent.type}.`,
          actor: "postmaster",
          details: {
            observer: observer.registration.name,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  }

  private buildErrorMessage(
    original: MailmanMessage,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ): MailmanMessage {
    const type =
      original.type.startsWith("agent.") || original.type.startsWith("health.")
        ? "agent.error"
        : "error.report";

    return normalizeMessage({
      protocol: original.protocol,
      conversationId: original.conversationId,
      taskId: original.taskId ?? original.conversationId,
      replyTo: original.messageId,
      parentPacketId: original.packetId ?? original.messageId,
      correlationId: original.correlationId ?? original.messageId,
      type,
      sender: "postmaster",
      target: original.sender,
      payload: {},
      status: "failed",
      error: { code, message, details },
    });
  }

  private incrementProcessed(): void {
    this.stats.messagesProcessed++;
    this.stats.packetsProcessed++;
  }

  private incrementFailures(): void {
    this.stats.messagesFailed++;
    this.stats.packetsFailed++;
  }

  private withTimeout(
    promise: Promise<MailmanMessage>,
    ms: number,
    original: MailmanMessage
  ): Promise<MailmanMessage> {
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

export { Postmaster as Runtime };

// ─────────────────────────────────────────────
//  Singleton (for CLI / simple usage)
// ─────────────────────────────────────────────

let _instance: Postmaster | null = null;

export function getPostmaster(): Postmaster {
  if (!_instance) {
    _instance = new Postmaster();
  }
  return _instance;
}

export const getRuntime = getPostmaster;

export function resetPostmaster(): void {
  _instance = null;
}

export const resetRuntime = resetPostmaster;
