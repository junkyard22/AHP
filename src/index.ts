// ─────────────────────────────────────────────
//  Mailman — public API
// ─────────────────────────────────────────────

// Packet types + factories
export * from "./packet/types";
export * from "./packet/createPacket";

// Core
export { Runtime, getRuntime, resetRuntime } from "./core/runtime";
export type { RuntimeConfig, TelemetryEvent, TelemetryHook } from "./core/runtime";
export { Registry } from "./core/registry";
export { Router } from "./core/router";
export { Validator } from "./core/validator";
export { TraceStore } from "./core/traceStore";
export type { TraceQuery } from "./core/traceStore";
export { DeadLetterQueue } from "./core/dlq";
export type { DLQEntry } from "./core/dlq";
export { MailmanError, ErrorCode } from "./core/errors";
export type { MiddlewareFn } from "./core/middleware";
export { DEFAULT_RETRY_POLICY } from "./core/retry";
export type { RetryPolicy } from "./core/retry";
export { DEFAULT_DB_PATH } from "./core/db";

// Pluggable backends (Item 10)
export { MemoryTraceStore, MemoryDLQStore } from "./core/backends";
export type { ITraceStore, IDLQStore } from "./core/backends";

// Pub/Sub (Item 2)
export { EventBus } from "./core/eventBus";
export type { TopicHandler } from "./core/eventBus";

// Streaming (Item 4)
export { StreamSession, StreamSessionStore } from "./core/streamSession";

// Capability routing (Item 6)
export { LoadBalancer } from "./core/loadBalancer";
export type { BalanceStrategy } from "./core/loadBalancer";

// Scheduling (Item 8)
export { PacketScheduler } from "./core/scheduler";
export type { ScheduledEntry } from "./core/scheduler";

// Transport
export { MailmanServer } from "./transport/server";
export type { MailmanServerConfig, AuthConfig } from "./transport/server";
export { RemoteMailmanClient } from "./transport/remoteClient";
export type { RemoteClientConfig } from "./transport/remoteClient";
export { MailmanWsServer } from "./transport/wsServer";
export type { WsServerConfig } from "./transport/wsServer";

// Client
export { MailmanClient, createClient } from "./client/client";

// Utils
export { newPacketId, newTaskId, newId } from "./utils/ids";
export { now, elapsedMs } from "./utils/time";
