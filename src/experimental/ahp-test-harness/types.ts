export type AHPTestEventType =
  | "TASK_ACCEPTED"
  | "TASK_PROGRESS"
  | "TASK_PARTIAL_OUTPUT"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "TASK_CANCELLED"
  | "AGENT_ONLINE"
  | "AGENT_OFFLINE";

export type AHPEnvelopeKind =
  | "session.connect"
  | "session.connected"
  | "task.send"
  | "task.accept"
  | "task.progress"
  | "task.partial_output"
  | "task.completed"
  | "task.failed"
  | "task.cancel"
  | "task.cancelled"
  | "agent.online"
  | "agent.offline";

export type AHPTestDirection =
  | "maestro->workbench"
  | "workbench->ahp"
  | "ahp->workbench"
  | "workbench->maestro";

export type AHPTestTransportKind = "in-memory" | "local";

export interface AHPTestError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface AHPTestTimeouts {
  handshakeTimeoutMs: number;
  taskAckTimeoutMs: number;
  inactivityTimeoutMs: number;
  maxIdempotentRetries: number;
}

export interface AHPTestSessionConfig {
  sessionId?: string;
  metadata?: Record<string, unknown>;
  timeouts?: Partial<AHPTestTimeouts>;
}

export interface AHPTestSession {
  sessionId: string;
  connectedAt: string;
}

export interface CanonicalAgentDescriptor {
  agentId: string;
  name?: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface CanonicalTaskEnvelope {
  taskId: string;
  agentId: string;
  sessionId?: string;
  payload: Record<string, unknown>;
  idempotent?: boolean;
}

export interface AHPEnvelope {
  protocol: "ahp-test-harness/v1";
  kind: AHPEnvelopeKind;
  messageId: string;
  correlationId: string;
  taskId: string;
  agentId: string;
  sessionId: string;
  sender: string;
  target: string;
  attempt: number;
  timestamp: string;
  payload?: Record<string, unknown>;
  error?: AHPTestError;
}

export interface AHPTestEvent {
  eventType: AHPTestEventType;
  messageId: string;
  correlationId: string;
  taskId: string;
  agentId: string;
  sessionId: string;
  timestamp: string;
  sequence: number;
  payload?: Record<string, unknown>;
  error?: AHPTestError;
}

export interface AHPTestLogEntry {
  direction: AHPTestDirection;
  messageId: string;
  correlationId: string;
  taskId: string;
  agentId: string;
  sessionId: string;
  eventType: string;
  latencyMs: number;
  timestamp: string;
}

export interface AHPTestAgentContext {
  readonly taskId: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly signal: AbortSignal;
  accept(payload?: Record<string, unknown>): AHPEnvelope;
  progress(payload: Record<string, unknown>): AHPEnvelope;
  partialOutput(payload: Record<string, unknown>): AHPEnvelope;
  complete(payload?: Record<string, unknown>): AHPEnvelope;
  fail(error: AHPTestError): AHPEnvelope;
  cancelled(payload?: Record<string, unknown>): AHPEnvelope;
}

export type AHPTestAgentHandler = (
  envelope: AHPEnvelope,
  context: AHPTestAgentContext
) => Promise<void> | void;

export interface AHPTestAgentDescriptor extends CanonicalAgentDescriptor {
  handler: AHPTestAgentHandler;
}

export interface CanonicalApi {
  connect(sessionConfig: AHPTestSessionConfig): Promise<AHPTestSession>;
  registerAgent(agentDescriptor: AHPTestAgentDescriptor): Promise<void>;
  sendTask(taskEnvelope: CanonicalTaskEnvelope): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  onEvent(callback: (event: AHPTestEvent) => void): () => void;
}

export interface MaestroTaskDto {
  taskId: string;
  agentId: string;
  prompt: string;
  input?: Record<string, unknown>;
  idempotent?: boolean;
}

export interface MaestroCancelDto {
  taskId: string;
}
