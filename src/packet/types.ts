// ─────────────────────────────────────────────
//  Postmaster protocol types — canonical AI-agent shape
// ─────────────────────────────────────────────

export const POSTMASTER_PROTOCOL_VERSION = "postmaster.agent/v1" as const;
export const MAILMAN_PROTOCOL_VERSION = "mailman.agent/v1" as const;
export const DEFAULT_PROTOCOL_VERSION = POSTMASTER_PROTOCOL_VERSION;
export const SUPPORTED_PROTOCOL_VERSIONS = [
  POSTMASTER_PROTOCOL_VERSION,
  MAILMAN_PROTOCOL_VERSION,
] as const;

export type SupportedProtocolVersion =
  (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];
export type PostmasterProtocolVersion = SupportedProtocolVersion;
export type MailmanProtocolVersion = SupportedProtocolVersion;

export const AGENT_MESSAGE_TYPES = [
  "agent.message",
  "agent.request",
  "agent.response",
  "agent.event",
  "agent.stream",
  "agent.error",
  "health.ping",
  "health.pong",
] as const;

export const LEGACY_PACKET_TYPES = [
  "task.assign",
  "task.accept",
  "task.reject",
  "task.result",
  "review.request",
  "review.result",
  "route.request",
  "route.result",
  "error.report",
] as const;

export type AgentMessageType = (typeof AGENT_MESSAGE_TYPES)[number];
export type LegacyPacketType = (typeof LEGACY_PACKET_TYPES)[number];
export type MessageType = AgentMessageType | LegacyPacketType;
export type PacketType = MessageType;

export type MessageStatus =
  | "created"
  | "validated"
  | "routed"
  | "delivered"
  | "acknowledged"
  | "accepted"
  | "rejected"
  | "completed"
  | "failed"
  | "timed_out";

export type PacketStatus = MessageStatus;

export type MailmanContentPart = {
  type: "text" | "json" | "tool_call" | "tool_result" | "artifact" | "unknown";
  mimeType?: string;
  text?: string;
  data?: unknown;
  uri?: string;
};

export type MailmanMessageContent = {
  summary?: string;
  text?: string;
  mimeType?: string;
  parts?: MailmanContentPart[];
};

export type MailmanExpectation = {
  format?: string;
  requiredFields?: string[];
  responseTypes?: MessageType[];
  schema?: string;
};

export type MailmanMessage = {
  protocol: string;

  messageId: string;
  packetId?: string;

  conversationId: string;
  taskId?: string;

  replyTo?: string;
  parentPacketId?: string;
  correlationId?: string;

  type: MessageType;
  sender: string;
  target: string;

  channel?: string;
  intent?: string;
  timestamp: string;
  headers?: Record<string, string>;

  payload: Record<string, unknown>;
  content?: MailmanMessageContent;

  context?: {
    threadId?: string;
    turnId?: string;
    participants?: string[];
    capabilities?: string[];
    artifacts?: string[];
  };

  scope?: {
    files?: string[];
    repoWide?: boolean;
    artifacts?: string[];
  };

  constraints?: {
    allowNewFiles?: boolean;
    maxFilesChanged?: number;
    preservePublicApi?: boolean;
    readOnly?: boolean;
  };

  expects?: MailmanExpectation;
  expectedOutput?: MailmanExpectation;

  status?: MessageStatus;

  confidence?: number;
  evidence?: string[];
  risks?: string[];

  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };

  meta?: {
    timeoutMs?: number;
    replyRequired?: boolean;
    priority?: "low" | "normal" | "high";
    tags?: string[];
  };
};

export type MailmanPacket = MailmanMessage;

// ─────────────────────────────────────────────
//  Agent registration
// ─────────────────────────────────────────────

export type MailmanAgentRegistration = {
  name: string;
  accepts: MessageType[];
  protocols?: string[];
  capabilities?: string[];
  intents?: string[];
  description?: string;
  version?: string;
  kind?: "agent" | "tool" | "service";
  health?: "healthy" | "degraded" | "offline";
  metadata?: Record<string, unknown>;
};

export type MailmanRoleRegistration = MailmanAgentRegistration;

// ─────────────────────────────────────────────
//  Observation + troubleshooting
// ─────────────────────────────────────────────

export type PostmasterObservationSeverity = "info" | "warning" | "error";

export type PostmasterObservationStage =
  | "runtime"
  | "ingress"
  | "validation"
  | "routing"
  | "delivery"
  | "handler"
  | "response";

export type PostmasterObservation = {
  observationId: string;
  messageId: string;
  conversationId: string;
  severity: PostmasterObservationSeverity;
  stage: PostmasterObservationStage;
  code: string;
  summary: string;
  actor: string;
  timestamp: string;
  details?: Record<string, unknown>;
};

export type PostmasterRuntimeEventType =
  | "runtime.started"
  | "runtime.stopped"
  | "message.received"
  | "message.validated"
  | "message.rejected"
  | "message.routed"
  | "message.delivered"
  | "message.completed"
  | "message.failed"
  | "handler.started"
  | "handler.finished"
  | "handler.threw";

export type PostmasterRuntimeEvent = {
  eventId: string;
  type: PostmasterRuntimeEventType;
  stage: PostmasterObservationStage;
  actor: string;
  timestamp: string;
  message?: MailmanMessage;
  response?: MailmanMessage;
  durationMs?: number;
  details?: Record<string, unknown>;
  error?: {
    code?: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type PostmasterObserverRegistration = {
  name: string;
  description?: string;
  events?: PostmasterRuntimeEventType[];
  stages?: PostmasterObservationStage[];
};

export type PostmasterObserver = {
  registration: PostmasterObserverRegistration;
  onEvent(event: PostmasterRuntimeEvent): void | Promise<void>;
};

export type PostmasterTroubleshootingTarget = {
  messageId?: string;
  conversationId?: string;
};

export type PostmasterTroubleshootingReport = {
  generatedAt: string;
  scope: PostmasterTroubleshootingTarget;
  status: "healthy" | "warning" | "error";
  summary: {
    totalMessages: number;
    totalTraces: number;
    totalObservations: number;
    warningCount: number;
    errorCount: number;
    participants: string[];
  };
  traces: MailmanTraceEntry[];
  observations: PostmasterObservation[];
};

// ─────────────────────────────────────────────
//  Handler + runtime interface
// ─────────────────────────────────────────────

export type MessageHandler = (
  message: MailmanMessage
) => Promise<MailmanMessage>;

export type PacketHandler = MessageHandler;

export interface MailmanRuntime {
  registerAgent(agent: MailmanAgentRegistration, handler: MessageHandler): void;
  unregisterAgent(name: string): void;

  registerObserver(observer: PostmasterObserver): void;
  unregisterObserver(name: string): void;

  send(message: MailmanMessage): Promise<MailmanMessage>;
  ping(agentName: string): Promise<boolean>;

  listAgents(): MailmanAgentRegistration[];
  listObservers(): PostmasterObserverRegistration[];
  getMessageTrace(messageId: string): MailmanTraceEntry[];
  getConversationTrace(conversationId: string): MailmanTraceEntry[];
  getMessageObservations(messageId: string): PostmasterObservation[];
  getConversationObservations(conversationId: string): PostmasterObservation[];
  createTroubleshootingReport(
    target: PostmasterTroubleshootingTarget
  ): PostmasterTroubleshootingReport;

  registerRole(role: MailmanRoleRegistration, handler: PacketHandler): void;
  unregisterRole(name: string): void;
  listRoles(): MailmanRoleRegistration[];
  getTrace(packetId: string): MailmanTraceEntry[];
  getTaskTrace(taskId: string): MailmanTraceEntry[];
}

// ─────────────────────────────────────────────
//  Trace log
// ─────────────────────────────────────────────

export type MessageTraceEvent =
  | "message.received"
  | "message.validated"
  | "message.rejected"
  | "message.routed"
  | "message.delivered"
  | "message.completed"
  | "message.failed"
  | "handler.started"
  | "handler.finished"
  | "handler.threw";

export type LegacyTraceEvent =
  | "packet.received"
  | "packet.validated"
  | "packet.rejected"
  | "packet.routed"
  | "packet.delivered"
  | "packet.completed"
  | "packet.failed";

export type MailmanTraceEvent = MessageTraceEvent | LegacyTraceEvent;

export type MailmanTraceEntry = {
  traceId: string;
  messageId: string;
  packetId: string;
  conversationId: string;
  taskId: string;
  event: MailmanTraceEvent;
  actor: string;
  timestamp: string;
  details?: Record<string, unknown>;
};

// ─────────────────────────────────────────────
//  Validation sets
// ─────────────────────────────────────────────

export const ALL_MESSAGE_TYPES: MessageType[] = [
  ...AGENT_MESSAGE_TYPES,
  ...LEGACY_PACKET_TYPES,
];

export const ALL_PACKET_TYPES: PacketType[] = ALL_MESSAGE_TYPES;

export const REPLY_LIKE_MESSAGE_TYPES: MessageType[] = [
  "agent.response",
  "agent.error",
  "health.pong",
  "task.accept",
  "task.reject",
  "task.result",
  "review.result",
  "route.result",
  "error.report",
];

// ─────────────────────────────────────────────
//  Postmaster aliases — canonical naming
// ─────────────────────────────────────────────

export type PostmasterMessage = MailmanMessage;
export type PostmasterPacket = MailmanPacket;
export type PostmasterAgentRegistration = MailmanAgentRegistration;
export type PostmasterRoleRegistration = MailmanRoleRegistration;
export type PostmasterTraceEvent = MailmanTraceEvent;
export type PostmasterTraceEntry = MailmanTraceEntry;
export type PostmasterRuntime = MailmanRuntime;
export type PostmasterExpectation = MailmanExpectation;
export type PostmasterMessageContent = MailmanMessageContent;
export type PostmasterContentPart = MailmanContentPart;
