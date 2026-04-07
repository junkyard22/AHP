import { AHPTestBus } from "./AHPTestBus";
import {
  AHPTestAgentDescriptor,
  AHPTestEvent,
  AHPTestSession,
  AHPTestSessionConfig,
  MaestroTaskDto,
} from "./types";

export class MaestroTestAdapter {
  private sessionId?: string;

  constructor(private readonly bus: AHPTestBus) {}

  async connect(sessionConfig: AHPTestSessionConfig): Promise<AHPTestSession> {
    const session = await this.bus.connect(sessionConfig);
    this.sessionId = session.sessionId;

    this.bus.recordMaestroIngress({
      taskId: `session:${session.sessionId}`,
      agentId: "workbench-test-harness",
      sessionId: session.sessionId,
      correlationId: `session:${session.sessionId}`,
      eventType: "SESSION_CONNECT",
    });

    return session;
  }

  async registerAgent(agentDescriptor: AHPTestAgentDescriptor): Promise<void> {
    await this.bus.registerAgent(agentDescriptor);
  }

  async sendTask(task: MaestroTaskDto): Promise<void> {
    const sessionId = this.requireSessionId();

    this.bus.recordMaestroIngress({
      taskId: task.taskId,
      agentId: task.agentId,
      sessionId,
      correlationId: task.taskId,
      eventType: "TASK_SEND",
    });

    await this.bus.sendTask({
      taskId: task.taskId,
      agentId: task.agentId,
      sessionId,
      idempotent: task.idempotent,
      payload: {
        prompt: task.prompt,
        ...(task.input ?? {}),
      },
    });
  }

  async cancelTask(taskId: string): Promise<void> {
    const sessionId = this.requireSessionId();

    this.bus.recordMaestroIngress({
      taskId,
      agentId: "workbench-test-harness",
      sessionId,
      correlationId: taskId,
      eventType: "TASK_CANCEL",
    });

    await this.bus.cancelTask(taskId);
  }

  onEvent(callback: (event: AHPTestEvent) => void): () => void {
    return this.bus.onEvent(callback);
  }

  traceTask(taskId: string) {
    return this.bus.traceTask(taskId);
  }

  allTraces() {
    return this.bus.allTraces();
  }

  private requireSessionId(): string {
    if (!this.sessionId) {
      throw new Error("Maestro test adapter is not connected");
    }

    return this.sessionId;
  }
}
