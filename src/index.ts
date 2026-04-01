// ─────────────────────────────────────────────
//  Mailman v1 — public API
// ─────────────────────────────────────────────

// Packet types + factories
export * from "./packet/types";
export * from "./packet/createPacket";

// Core
export { Runtime, getRuntime, resetRuntime } from "./core/runtime";
export type { RuntimeConfig } from "./core/runtime";
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

// Transport
export { MailmanServer } from "./transport/server";
export type { MailmanServerConfig } from "./transport/server";
export { RemoteMailmanClient } from "./transport/remoteClient";
export type { RemoteClientConfig } from "./transport/remoteClient";

// Client
export { MailmanClient, createClient } from "./client/client";

// Utils
export { newPacketId, newTaskId, newId } from "./utils/ids";
export { now, elapsedMs } from "./utils/time";
