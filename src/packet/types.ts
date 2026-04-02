// ─────────────────────────────────────────────
//  Packet types — canonical v1 shape
// ─────────────────────────────────────────────

/** All packet types shipped with Mailman. */
export type BuiltinPacketType =
  | "task.assign"
  | "task.accept"
  | "task.reject"
  | "task.result"
  | "task.ack"        // acknowledge receipt without delivering result yet
  | "task.nack"       // reject receipt (agent cannot process)
  | "review.request"
  | "review.result"
  | "route.request"
  | "route.result"
  | "error.report"
  | "health.ping"
  | "health.pong"
  | "stream.open"     // open a streaming session
  | "stream.chunk"    // one chunk of a stream (token, line, etc.)
  | "stream.close"    // graceful stream end
  | "stream.error";   // stream terminated with error

/**
 * PacketType is intentionally open-ended:
 *   - built-in union for full type-safety on known types
 *   - `string & {}` allows user-defined types without losing intellisense
 *
 * Register custom types with `runtime.registerPacketType('my.type')`.
 */
export type PacketType = BuiltinPacketType | (string & {});

export type PacketStatus =
  | "created"
  | "validated"
  | "delivered"
  | "accepted"
  | "rejected"
  | "completed"
  | "failed"
  | "timed_out";

export type MailmanPacket = {
  packetId: string;
  taskId: string;
  parentPacketId?: string;

  type: PacketType;
  sender: string;
  target: string;

  intent?: string;
  timestamp: string;

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

  payload: Record<string, unknown>;

  expectedOutput?: {
    format?: string;
    requiredFields?: string[];
  };

  status?: PacketStatus;

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
    /** When true, handler must return task.ack immediately; full result via deliverResult() */
    ackRequired?: boolean;
    tags?: string[];
    /** Set by runtime.openStream() — links stream.* packets to a session */
    streamId?: string;
    /** Monotonically increasing index for stream.chunk ordering */
    chunkIndex?: number;
  };
};

// ─────────────────────────────────────────────
//  Role registration
// ─────────────────────────────────────────────

export type MailmanRoleRegistration = {
  name: string;
  accepts: PacketType[];
  /**
   * Semantic capabilities this role provides.
   * Used by runtime.sendToCapability() for dynamic routing.
   * Example: ["summarize", "translate", "classify"]
   */
  capabilities?: string[];
  intents?: string[];
  description?: string;
  version?: string;
  health?: "healthy" | "degraded" | "offline";
};

// ─────────────────────────────────────────────
//  Handler types
// ─────────────────────────────────────────────

export type PacketHandler = (packet: MailmanPacket) => Promise<MailmanPacket>;

/** Controls an active streaming session from the handler side. */
export interface StreamController {
  /** Push a text chunk to the consumer. */
  push(chunk: string): void;
  /** Signal clean end of stream. */
  end(): void;
  /** Terminate stream with an error. */
  error(err: Error): void;
}

/**
 * Handler for roles registered via runtime.registerStreamRole().
 * Call stream.push(chunk) for each output piece, then stream.end().
 */
export type StreamHandler = (
  packet: MailmanPacket,
  stream: StreamController
) => Promise<void>;

// ─────────────────────────────────────────────
//  Runtime interface
// ─────────────────────────────────────────────

export interface MailmanRuntime {
  registerRole(role: MailmanRoleRegistration, handler: PacketHandler): void;
  unregisterRole(name: string): void;

  send(packet: MailmanPacket): Promise<MailmanPacket>;
  dispatch(packet: MailmanPacket): void;
  ping(roleName: string): Promise<boolean>;

  subscribe(topic: string, handler: (packet: MailmanPacket) => void): () => void;
  publish(packet: MailmanPacket): void;

  listRoles(): MailmanRoleRegistration[];
  getTrace(packetId: string): MailmanTraceEntry[];
}

// ─────────────────────────────────────────────
//  Trace log
// ─────────────────────────────────────────────

export type MailmanTraceEvent =
  | "packet.received"
  | "packet.validated"
  | "packet.rejected"
  | "packet.routed"
  | "packet.delivered"
  | "packet.completed"
  | "packet.failed"
  | "packet.dispatched"
  | "packet.published"
  | "handler.started"
  | "handler.finished"
  | "handler.threw"
  | "stream.opened"
  | "stream.chunk"
  | "stream.closed"
  | "stream.errored"
  | "packet.scheduled"
  | "packet.acked"
  | "packet.nacked";

export type MailmanTraceEntry = {
  traceId: string;
  packetId: string;
  taskId: string;
  event: MailmanTraceEvent;
  actor: string;
  timestamp: string;
  details?: Record<string, unknown>;
};

// ─────────────────────────────────────────────
//  Known built-in packet types (for validation)
// ─────────────────────────────────────────────

export const BUILTIN_PACKET_TYPES: BuiltinPacketType[] = [
  "task.assign",
  "task.accept",
  "task.reject",
  "task.result",
  "task.ack",
  "task.nack",
  "review.request",
  "review.result",
  "route.request",
  "route.result",
  "error.report",
  "health.ping",
  "health.pong",
  "stream.open",
  "stream.chunk",
  "stream.close",
  "stream.error",
];

/** @deprecated Use BUILTIN_PACKET_TYPES. Will be removed in v1. */
export const ALL_PACKET_TYPES: PacketType[] = BUILTIN_PACKET_TYPES;
