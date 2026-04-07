import { createAHPTestEnvelope } from "./envelopes";
import {
  AHPEnvelope,
  AHPEnvelopeKind,
  AHPTestAgentContext,
  AHPTestAgentDescriptor,
  AHPTestError,
} from "./types";

type Emitter = (envelope: AHPEnvelope) => void;

type TaskRuntime = {
  agentId: string;
  accepted: boolean;
  terminal: boolean;
  cancelRequested: boolean;
  controller: AbortController;
};

export class AHPTestAgentHost {
  private readonly agents = new Map<string, AHPTestAgentDescriptor>();
  private readonly taskRuntimes = new Map<string, TaskRuntime>();
  private emitter?: Emitter;

  attachEmitter(handler: Emitter): void {
    this.emitter = handler;
  }

  registerAgent(agentDescriptor: AHPTestAgentDescriptor, sessionId: string): void {
    this.agents.set(agentDescriptor.agentId, agentDescriptor);
    this.emitAgentStatus("agent.online", agentDescriptor.agentId, sessionId);
  }

  registeredAgentIds(): string[] {
    return [...this.agents.keys()];
  }

  emitAgentOffline(agentId: string, sessionId: string): void {
    if (!this.agents.has(agentId)) {
      return;
    }

    this.emitAgentStatus("agent.offline", agentId, sessionId);
  }

  emitAgentOfflineBatch(agentIds: string[], sessionId: string): void {
    for (const agentId of agentIds) {
      this.emitAgentOffline(agentId, sessionId);
    }
  }

  injectEnvelope(envelope: AHPEnvelope): void {
    this.emitter?.(envelope);
  }

  async handleEnvelope(envelope: AHPEnvelope): Promise<void> {
    switch (envelope.kind) {
      case "session.connect":
        this.handleSessionConnect(envelope);
        return;
      case "task.send":
        this.handleTaskSend(envelope);
        return;
      case "task.cancel":
        this.handleTaskCancel(envelope);
        return;
      default:
        return;
    }
  }

  private handleSessionConnect(envelope: AHPEnvelope): void {
    this.injectEnvelope(
      createAHPTestEnvelope({
        kind: "session.connected",
        taskId: envelope.taskId,
        correlationId: envelope.correlationId,
        agentId: envelope.agentId,
        sessionId: envelope.sessionId,
        sender: "ahp-test-harness",
        target: envelope.sender,
        attempt: envelope.attempt,
        payload: { connected: true },
      })
    );
  }

  private handleTaskSend(envelope: AHPEnvelope): void {
    const existing = this.taskRuntimes.get(envelope.taskId);
    if (existing) {
      if (existing.accepted && !existing.terminal) {
        this.emitTaskEnvelope("task.accept", envelope, { duplicateSend: true });
      }
      return;
    }

    const agent = this.agents.get(envelope.agentId);
    if (!agent) {
      this.emitTaskEnvelope("task.failed", envelope, undefined, {
        code: "UNKNOWN_AGENT",
        message: `No test agent registered for "${envelope.agentId}"`,
      });
      return;
    }

    const runtime: TaskRuntime = {
      agentId: envelope.agentId,
      accepted: false,
      terminal: false,
      cancelRequested: false,
      controller: new AbortController(),
    };

    this.taskRuntimes.set(envelope.taskId, runtime);

    const context: AHPTestAgentContext = {
      taskId: envelope.taskId,
      sessionId: envelope.sessionId,
      agentId: envelope.agentId,
      signal: runtime.controller.signal,
      accept: (payload) => {
        runtime.accepted = true;
        return this.emitTaskEnvelope("task.accept", envelope, payload);
      },
      progress: (payload) => this.emitTaskEnvelope("task.progress", envelope, payload),
      partialOutput: (payload) => this.emitTaskEnvelope("task.partial_output", envelope, payload),
      complete: (payload) => {
        runtime.terminal = true;
        return this.emitTaskEnvelope("task.completed", envelope, payload);
      },
      fail: (error) => {
        runtime.terminal = true;
        return this.emitTaskEnvelope("task.failed", envelope, undefined, error);
      },
      cancelled: (payload) => {
        runtime.terminal = true;
        return this.emitTaskEnvelope("task.cancelled", envelope, payload);
      },
    };

    Promise.resolve(agent.handler(envelope, context))
      .then(() => {
        if (runtime.controller.signal.aborted && !runtime.terminal) {
          context.cancelled({ reason: "cancelled by orchestrator" });
        }
      })
      .catch((error: unknown) => {
        if (runtime.terminal) {
          return;
        }

        context.fail({
          code: "AGENT_HANDLER_THROWN",
          message: error instanceof Error ? error.message : "Unknown agent failure",
        });
      });
  }

  private handleTaskCancel(envelope: AHPEnvelope): void {
    const runtime = this.taskRuntimes.get(envelope.taskId);
    if (!runtime || runtime.cancelRequested || runtime.terminal) {
      return;
    }

    runtime.cancelRequested = true;
    runtime.controller.abort();

    setTimeout(() => {
      if (!runtime.terminal) {
        runtime.terminal = true;
        this.emitTaskEnvelope("task.cancelled", envelope, {
          reason: "cancelled by orchestrator",
        });
      }
    }, 0);
  }

  private emitAgentStatus(
    kind: "agent.online" | "agent.offline",
    agentId: string,
    sessionId: string
  ): AHPEnvelope {
    const taskId = `agent:${agentId}`;
    const envelope = createAHPTestEnvelope({
      kind,
      taskId,
      correlationId: taskId,
      agentId,
      sessionId,
      sender: "ahp-test-harness",
      target: "workbench-test-harness",
      attempt: 1,
      payload: {},
    });

    this.injectEnvelope(envelope);
    return envelope;
  }

  private emitTaskEnvelope(
    kind: Extract<
      AHPEnvelopeKind,
      "task.accept" | "task.progress" | "task.partial_output" | "task.completed" | "task.failed" | "task.cancelled"
    >,
    outbound: AHPEnvelope,
    payload?: Record<string, unknown>,
    error?: AHPTestError
  ): AHPEnvelope {
    const envelope = createAHPTestEnvelope({
      kind,
      taskId: outbound.taskId,
      correlationId: outbound.correlationId,
      agentId: outbound.agentId,
      sessionId: outbound.sessionId,
      sender: outbound.agentId,
      target: "workbench-test-harness",
      attempt: outbound.attempt,
      payload,
      error,
    });

    this.injectEnvelope(envelope);
    return envelope;
  }
}
