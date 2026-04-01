// ─────────────────────────────────────────────
//  Mailman v1 — public API
// ─────────────────────────────────────────────

// Packet types + schemas
export * from "./packet/types";
export * from "./packet/createPacket";

// Core
export { Runtime, getRuntime, resetRuntime } from "./core/runtime";
export { Registry } from "./core/registry";
export { Router } from "./core/router";
export { Validator } from "./core/validator";
export { TraceStore } from "./core/traceStore";
export { MailmanError, ErrorCode } from "./core/errors";
export type { MiddlewareFn } from "./core/middleware";

// Client
export { MailmanClient, createClient } from "./client/client";

// Utils
export { newPacketId, newTaskId, newId } from "./utils/ids";
export { now, elapsedMs } from "./utils/time";
