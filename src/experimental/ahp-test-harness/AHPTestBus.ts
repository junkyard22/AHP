import { newId } from "../../utils/ids";
import { now } from "../../utils/time";
import { DEFAULT_AHP_TEST_TIMEOUTS } from "./config";
import { createAHPTestEnvelope } from "./envelopes";
import { AHPTestTraceStore } from "./logging";
import { AHPTestTransport } from "./transport";
import {
  AHPEnvelope,
  AHPTestAgentDescriptor,
  AHPTestError,
  AHPTestEvent,
  AHPTestEventType,
  AHPTestSession,
  AHPTestSessionConfig,
  AHPTestTimeouts,
  CanonicalApi,
  CanonicalTaskEnvelope,
} from "./types";

type TaskState = {
  task: CanonicalTaskEnvelope;
  agentId: string;
  sessionId: string;
  accepted: boolean;
  terminal: boolean;
  cancelRequested: boolean;
  idempotent: boolean;
  attempts: number;
  ackTimer?: ReturnType<typeof setTimeout>;
  inactivityTimer?: ReturnType<typeof setTimeout>;
};

function createEventMessageId(): string {
  return newId("maestro_msg");
}

function mergeTimeouts(overrides?: Partial<AHPTestTimeouts>): AHPTestTimeouts {
  return {
    ...DEFAULT_AHP_TEST_TIMEOUTS,
    ...overrides,
  };
}

export class AHPTestBus implements CanonicalApi {
  private readonly subscribers = new Set<(event: AHPTestEvent) => void>();
  private readonly taskStates = new Map<string, TaskState>();
  private readonly taskSequences = new Map<string, number>();
  private readonly seenMessageIds = new Set<string>();
  private readonly registeredAgents = new Map<string, AHPTestAgentDescriptor>();
  private readonly pendingSessions = new Map<string, (envelope: AHPEnvelope) => void>();

  private session?: AHPTestSession;
  private timeouts: AHPTestTimeouts;

  constructor(
    private readonly transport: AHPTestTransport,
    private readonly traces: AHPTestTraceStore,
    timeouts?: Partial<AHPTestTimeouts>
  ) {
    this.timeouts = mergeTimeouts(timeouts);
    this.transport.attachReceiver((envelope) => this.receiveEnvelope(envelope));
  }

  async connect(sessionConfig: AHPTestSessionConfig): Promise<AHPTestSession> {
    this.timeouts = mergeTimeouts(sessionConfig.timeouts ?? this.timeouts);

    if (this.session) {
      return this.session;
    }

    const sessionId = sessionConfig.sessionId ?? newId("ahp_session");
    const taskId = `session:${sessionId}`;
    const envelope = createAHPTestEnvelope({
      kind: "session.connect",
      taskId,
      correlationId: taskId,
      agentId: "workbench-test-harness",
      sessionId,
      sender: "workbench-test-harness",
      target: "ahp-test-harness",
      attempt: 1,
      payload: sessionConfig.metadata ?? {},
    });

    const responsePromise = new Promise<AHPEnvelope>((resolve) => {
      this.pendingSessions.set(taskId, resolve);
    });

    this.recordOutbound(envelope);

    try {
      await this.transport.sendEnvelope(envelope);
    } catch (error) {
      this.pendingSessions.delete(taskId);
      throw error;
    }

    const response = await this.withTimeout(
      responsePromise,
      this.timeouts.handshakeTimeoutMs,
      `Handshake timed out after ${this.timeouts.handshakeTimeoutMs}ms`
    );

    if (response.kind !== "session.connected") {
      throw new Error(`Unexpected handshake response: ${response.kind}`);
    }

    this.session = {
      sessionId,
      connectedAt: now(),
    };

    for (const agent of this.registeredAgents.values()) {
      await this.transport.registerAgent(agent, sessionId);
    }

    return this.session;
  }

  async registerAgent(agentDescriptor: AHPTestAgentDescriptor): Promise<void> {
    const session = this.requireSession();
    this.registeredAgents.set(agentDescriptor.agentId, agentDescriptor);
    await this.transport.registerAgent(agentDescriptor, session.sessionId);
  }

  async sendTask(taskEnvelope: CanonicalTaskEnvelope): Promise<void> {
    const session = this.requireSession();

    if (this.taskStates.has(taskEnvelope.taskId)) {
      return;
    }

    const state: TaskState = {
      task: {
        ...taskEnvelope,
        sessionId: session.sessionId,
      },
      agentId: taskEnvelope.agentId,
      sessionId: session.sessionId,
      accepted: false,
      terminal: false,
      cancelRequested: false,
      idempotent: taskEnvelope.idempotent !== false,
      attempts: 0,
    };

    this.taskStates.set(taskEnvelope.taskId, state);
    await this.dispatchTask(state);
  }

  async cancelTask(taskId: string): Promise<void> {
    const state = this.taskStates.get(taskId);
    if (!state || state.terminal || state.cancelRequested) {
      return;
    }

    state.cancelRequested = true;
    this.clearTimer(state.ackTimer);

    const envelope = createAHPTestEnvelope({
      kind: "task.cancel",
      taskId,
      correlationId: taskId,
      agentId: state.agentId,
      sessionId: state.sessionId,
      sender: "workbench-test-harness",
      target: state.agentId,
      attempt: 1,
      payload: { reason: "cancel requested" },
    });

    this.recordOutbound(envelope);
    await this.transport.sendEnvelope(envelope);
  }

  onEvent(callback: (event: AHPTestEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  traceTask(taskId: string) {
    return this.traces.byTaskId(taskId);
  }

  allTraces() {
    return this.traces.all();
  }

  async restart(): Promise<void> {
    if (!this.session) {
      return;
    }

    const previousSessionId = this.session.sessionId;
    await this.transport.disconnect(previousSessionId, [...this.registeredAgents.keys()]);

    for (const state of this.taskStates.values()) {
      this.clearTimer(state.ackTimer);
      this.clearTimer(state.inactivityTimer);
    }

    this.session = undefined;
    this.seenMessageIds.clear();
  }

  async injectEnvelope(envelope: AHPEnvelope): Promise<void> {
    await this.transport.injectEnvelope(envelope);
  }

  recordMaestroIngress(params: {
    taskId: string;
    agentId: string;
    sessionId: string;
    correlationId: string;
    eventType: string;
    startedAt?: string;
  }): string {
    const messageId = createEventMessageId();
    this.traces.recordHop({
      direction: "maestro->workbench",
      messageId,
      correlationId: params.correlationId,
      taskId: params.taskId,
      agentId: params.agentId,
      sessionId: params.sessionId,
      eventType: params.eventType,
      startedAt: params.startedAt,
    });
    return messageId;
  }

  private async dispatchTask(state: TaskState): Promise<void> {
    if (state.terminal) {
      return;
    }

    state.attempts += 1;
    const envelope = createAHPTestEnvelope({
      kind: "task.send",
      taskId: state.task.taskId,
      correlationId: state.task.taskId,
      agentId: state.agentId,
      sessionId: state.sessionId,
      sender: "workbench-test-harness",
      target: state.agentId,
      attempt: state.attempts,
      payload: state.task.payload,
    });

    this.recordOutbound(envelope);
    await this.transport.sendEnvelope(envelope);
    this.armAckTimer(state);
    this.armInactivityTimer(state);
  }

  private receiveEnvelope(envelope: AHPEnvelope): void {
    this.traces.recordHop({
      direction: "ahp->workbench",
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      taskId: envelope.taskId,
      agentId: envelope.agentId,
      sessionId: envelope.sessionId,
      eventType: envelope.kind,
      startedAt: envelope.timestamp,
    });

    if (this.seenMessageIds.has(envelope.messageId)) {
      return;
    }

    this.seenMessageIds.add(envelope.messageId);

    if (envelope.kind === "session.connected") {
      const resolve = this.pendingSessions.get(envelope.taskId);
      if (resolve) {
        this.pendingSessions.delete(envelope.taskId);
        resolve(envelope);
      }
      return;
    }

    if (envelope.kind === "agent.online") {
      this.emitEvent("AGENT_ONLINE", envelope);
      return;
    }

    if (envelope.kind === "agent.offline") {
      this.emitEvent("AGENT_OFFLINE", envelope);
      return;
    }

    const state = this.taskStates.get(envelope.taskId);
    if (!state) {
      return;
    }

    if (state.terminal) {
      return;
    }

    this.armInactivityTimer(state);

    switch (envelope.kind) {
      case "task.accept":
        state.accepted = true;
        this.clearTimer(state.ackTimer);
        this.emitEvent("TASK_ACCEPTED", envelope);
        return;
      case "task.progress":
        this.emitEvent("TASK_PROGRESS", envelope);
        return;
      case "task.partial_output":
        this.emitEvent("TASK_PARTIAL_OUTPUT", envelope);
        return;
      case "task.completed":
        state.terminal = true;
        this.finishTask(state);
        this.emitEvent("TASK_COMPLETED", envelope);
        return;
      case "task.failed":
        state.terminal = true;
        this.finishTask(state);
        this.emitEvent("TASK_FAILED", envelope);
        return;
      case "task.cancelled":
        state.terminal = true;
        this.finishTask(state);
        this.emitEvent("TASK_CANCELLED", envelope);
        return;
      default:
        return;
    }
  }

  private emitEvent(eventType: AHPTestEventType, source: {
    correlationId: string;
    taskId: string;
    agentId: string;
    sessionId: string;
    timestamp: string;
    payload?: Record<string, unknown>;
    error?: AHPTestError;
  }): void {
    const messageId = createEventMessageId();
    const event: AHPTestEvent = {
      eventType,
      messageId,
      correlationId: source.correlationId,
      taskId: source.taskId,
      agentId: source.agentId,
      sessionId: source.sessionId,
      timestamp: now(),
      sequence: this.nextSequence(source.taskId),
      payload: source.payload,
      error: source.error,
    };

    this.traces.recordHop({
      direction: "workbench->maestro",
      messageId,
      correlationId: event.correlationId,
      taskId: event.taskId,
      agentId: event.agentId,
      sessionId: event.sessionId,
      eventType: event.eventType,
      startedAt: source.timestamp,
    });

    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  private armAckTimer(state: TaskState): void {
    this.clearTimer(state.ackTimer);
    state.ackTimer = setTimeout(() => {
      if (state.accepted || state.terminal) {
        return;
      }

      if (state.idempotent && state.attempts <= this.timeouts.maxIdempotentRetries) {
        void this.dispatchTask(state);
        return;
      }

      state.terminal = true;
      this.finishTask(state);
      this.emitEvent("TASK_FAILED", {
        correlationId: state.task.taskId,
        taskId: state.task.taskId,
        agentId: state.agentId,
        sessionId: state.sessionId,
        timestamp: now(),
        error: {
          code: "TASK_ACK_TIMEOUT",
          message: `No TASK_ACCEPTED received within ${this.timeouts.taskAckTimeoutMs}ms`,
        },
      });
    }, this.timeouts.taskAckTimeoutMs);
  }

  private armInactivityTimer(state: TaskState): void {
    this.clearTimer(state.inactivityTimer);
    state.inactivityTimer = setTimeout(() => {
      if (state.terminal) {
        return;
      }

      state.terminal = true;
      this.finishTask(state);
      this.emitEvent("TASK_FAILED", {
        correlationId: state.task.taskId,
        taskId: state.task.taskId,
        agentId: state.agentId,
        sessionId: state.sessionId,
        timestamp: now(),
        error: {
          code: "TASK_INACTIVITY_TIMEOUT",
          message: `No task activity received within ${this.timeouts.inactivityTimeoutMs}ms`,
        },
      });
    }, this.timeouts.inactivityTimeoutMs);
  }

  private finishTask(state: TaskState): void {
    this.clearTimer(state.ackTimer);
    this.clearTimer(state.inactivityTimer);
  }

  private nextSequence(taskId: string): number {
    const next = (this.taskSequences.get(taskId) ?? 0) + 1;
    this.taskSequences.set(taskId, next);
    return next;
  }

  private recordOutbound(envelope: AHPEnvelope): void {
    this.traces.recordHop({
      direction: "workbench->ahp",
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      taskId: envelope.taskId,
      agentId: envelope.agentId,
      sessionId: envelope.sessionId,
      eventType: envelope.kind,
      startedAt: envelope.timestamp,
    });
  }

  private requireSession(): AHPTestSession {
    if (!this.session) {
      throw new Error("AHP test harness is not connected");
    }

    return this.session;
  }

  private clearTimer(timer?: ReturnType<typeof setTimeout>): void {
    if (timer) {
      clearTimeout(timer);
    }
  }

  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(message));
      }, ms);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}
