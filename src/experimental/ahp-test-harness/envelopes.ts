import { newId } from "../../utils/ids";
import { now } from "../../utils/time";
import { AHPEnvelope, AHPEnvelopeKind, AHPTestError } from "./types";

function createMessageId(): string {
  return newId("ahp_msg");
}

export function createAHPTestEnvelope(init: {
  kind: AHPEnvelopeKind;
  taskId: string;
  correlationId: string;
  agentId: string;
  sessionId: string;
  sender: string;
  target: string;
  attempt: number;
  payload?: Record<string, unknown>;
  error?: AHPTestError;
}): AHPEnvelope {
  return {
    protocol: "ahp-test-harness/v1",
    messageId: createMessageId(),
    timestamp: now(),
    ...init,
  };
}
