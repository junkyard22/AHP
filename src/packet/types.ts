// ─────────────────────────────────────────────
//  Packet types — canonical v1 shape
// ─────────────────────────────────────────────

export type PacketType =
  | "task.assign"
  | "task.accept"
  | "task.reject"
  | "task.result"
  | "review.request"
  | "review.result"
  | "route.request"
  | "route.result"
  | "error.report"
  | "health.ping"
  | "health.pong";

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
    tags?: string[];
  };
};

// ─────────────────────────────────────────────
//  Role registration
// ─────────────────────────────────────────────

export type MailmanRoleRegistration = {
  name: string;
  accepts: PacketType[];
  intents?: string[];
  description?: string;
  version?: string;
  health?: "healthy" | "degraded" | "offline";
};

// ─────────────────────────────────────────────
//  Handler + runtime interface
// ─────────────────────────────────────────────

export type PacketHandler = (packet: MailmanPacket) => Promise<MailmanPacket>;

export interface MailmanRuntime {
  registerRole(role: MailmanRoleRegistration, handler: PacketHandler): void;
  unregisterRole(name: string): void;

  send(packet: MailmanPacket): Promise<MailmanPacket>;
  ping(roleName: string): Promise<boolean>;

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
  | "handler.started"
  | "handler.finished"
  | "handler.threw";

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
//  All known packet types (for validation sets)
// ─────────────────────────────────────────────

export const ALL_PACKET_TYPES: PacketType[] = [
  "task.assign",
  "task.accept",
  "task.reject",
  "task.result",
  "review.request",
  "review.result",
  "route.request",
  "route.result",
  "error.report",
  "health.ping",
  "health.pong",
];
