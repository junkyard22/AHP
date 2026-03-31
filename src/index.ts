// ─────────────────────────────────────────────
//  Postmaster v1 — public API
// ─────────────────────────────────────────────

// Message types + schemas
export * from "./packet/types";
export * from "./packet/createPacket";

// Core
export {
  Postmaster,
  Runtime,
  getPostmaster,
  getRuntime,
  resetPostmaster,
  resetRuntime,
} from "./core/runtime";
export { Registry } from "./core/registry";
export { Router } from "./core/router";
export { Validator } from "./core/validator";
export { TraceStore } from "./core/traceStore";
export { ObservationStore } from "./core/observationStore";
export { ErrorCode, MailmanError, PostmasterError } from "./core/errors";

// Client
export {
  MailmanClient,
  PostmasterClient,
  createClient,
  createPostmasterClient,
} from "./client/client";

// Utils
export {
  newConversationId,
  newId,
  newMessageId,
  newPacketId,
  newTaskId,
} from "./utils/ids";
export { now, elapsedMs } from "./utils/time";
