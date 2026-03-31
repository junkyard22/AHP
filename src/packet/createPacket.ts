import {
  DEFAULT_PROTOCOL_VERSION,
  MailmanMessage,
  MailmanPacket,
  MessageType,
} from "./types";
import { newConversationId, newMessageId } from "../utils/ids";
import { now } from "../utils/time";

// ─────────────────────────────────────────────
//  Factory helpers
// ─────────────────────────────────────────────

export type MessageInit = Omit<
  MailmanMessage,
  | "protocol"
  | "messageId"
  | "packetId"
  | "conversationId"
  | "taskId"
  | "replyTo"
  | "parentPacketId"
  | "timestamp"
> &
  Partial<
    Pick<
      MailmanMessage,
      | "protocol"
      | "messageId"
      | "packetId"
      | "conversationId"
      | "taskId"
      | "replyTo"
      | "parentPacketId"
      | "timestamp"
    >
  >;

/**
 * Normalize a message so canonical message/conversation fields and their
 * legacy packet/task aliases stay in sync on the wire.
 */
export function normalizeMessage(message: MessageInit | MailmanMessage): MailmanMessage {
  const messageId = message.messageId ?? message.packetId ?? newMessageId();
  const conversationId =
    message.conversationId ?? message.taskId ?? newConversationId();
  const replyTo = message.replyTo ?? message.parentPacketId;
  const expects = message.expects ?? message.expectedOutput;

  return {
    ...message,
    protocol: message.protocol ?? DEFAULT_PROTOCOL_VERSION,
    messageId,
    packetId: message.packetId ?? messageId,
    conversationId,
    taskId: message.taskId ?? conversationId,
    replyTo,
    parentPacketId: message.parentPacketId ?? replyTo,
    timestamp: message.timestamp ?? now(),
    expects,
    expectedOutput: message.expectedOutput ?? expects,
  };
}

/**
 * Create a Mailman message, filling in message, conversation, and timestamp
 * fields when not provided.
 */
export function createMessage(init: MessageInit): MailmanMessage {
  return normalizeMessage(init);
}

/**
 * Backward-compatible alias for the older packet terminology.
 */
export function createPacket(init: MessageInit): MailmanPacket {
  return createMessage(init);
}

/**
 * Build a typed reply message from a prior received message.
 */
export function createReply(
  original: MailmanMessage,
  type: MessageType,
  sender: string,
  payload: Record<string, unknown>,
  overrides?: Partial<MailmanMessage>
): MailmanMessage {
  return createMessage({
    protocol: original.protocol,
    conversationId: original.conversationId,
    taskId: original.taskId ?? original.conversationId,
    replyTo: original.messageId,
    parentPacketId: original.packetId ?? original.messageId,
    correlationId: original.correlationId ?? original.messageId,
    type,
    sender,
    target: original.sender,
    payload,
    ...overrides,
  });
}

export function createRequest(
  init: Omit<MessageInit, "type">
): MailmanMessage {
  return createMessage({
    ...init,
    type: "agent.request",
  });
}

export function createResponse(
  original: MailmanMessage,
  sender: string,
  payload: Record<string, unknown>,
  overrides?: Partial<MailmanMessage>
): MailmanMessage {
  return createReply(original, "agent.response", sender, payload, overrides);
}

export function createEvent(
  init: Omit<MessageInit, "type">
): MailmanMessage {
  return createMessage({
    ...init,
    type: "agent.event",
  });
}

export const createPostmasterMessage = createMessage;
export const createPostmasterPacket = createPacket;
export const createPostmasterReply = createReply;
export const createPostmasterRequest = createRequest;
export const createPostmasterResponse = createResponse;
export const createPostmasterEvent = createEvent;
