# Postmaster

Postmaster is an observable message protocol and runtime for AI agents.

It acts as the foundation beneath agent systems: it validates messages, routes them between agents, records traces, emits troubleshooting observations, and lets you attach runtime observers for deeper debugging.

Mailman remains available as a compatibility layer, but Postmaster is the upgraded foundation.

## What Postmaster adds

- A first-class `postmaster.agent/v1` protocol
- Message and conversation IDs for multi-turn agent exchanges
- Runtime observers that can watch message lifecycle events
- Built-in troubleshooting observations for validation failures, timeouts, slow handlers, reply mismatches, and legacy protocol usage
- Per-message and per-conversation troubleshooting reports

## Protocol shape

Each message carries:

- `messageId`: unique ID for the message
- `conversationId`: shared ID for a multi-turn exchange
- `replyTo`: the message being answered, when applicable
- `sender` / `target`: agent IDs on the wire
- `type`: protocol intent such as `agent.request` or `agent.response`
- `payload`: structured data exchanged between agents

Postmaster keeps backward-compatible aliases for older `packetId`, `taskId`, and role-oriented APIs so existing Mailman callers can migrate gradually.

## Supported message types

- `agent.message`
- `agent.request`
- `agent.response`
- `agent.event`
- `agent.stream`
- `agent.error`
- `health.ping`
- `health.pong`

Legacy packet types like `task.assign` and `review.request` are still accepted.

## Example

```ts
import {
  Postmaster,
  POSTMASTER_PROTOCOL_VERSION,
  createPostmasterReply,
  createPostmasterRequest,
  createPostmasterResponse,
} from "postmaster";

const postmaster = new Postmaster({
  slowMessageThresholdMs: 500,
});

postmaster.registerObserver({
  registration: {
    name: "console-debugger",
    events: ["message.failed", "message.completed", "handler.threw"],
  },
  onEvent(event) {
    console.log(`[${event.type}]`, event.message?.messageId, event.durationMs);
  },
});

postmaster.registerAgent(
  {
    name: "planner",
    kind: "agent",
    protocols: [POSTMASTER_PROTOCOL_VERSION],
    accepts: ["agent.request", "health.ping"],
    capabilities: ["planning", "task-breakdown"],
  },
  async (message) => {
    if (message.type === "health.ping") {
      return createPostmasterReply(message, "health.pong", "planner", {});
    }

    return createPostmasterResponse(message, "planner", {
      plan: ["inspect repo", "write protocol changes", "verify build"],
    });
  }
);

postmaster.start();

const reply = await postmaster.send(
  createPostmasterRequest({
    sender: "orchestrator",
    target: "planner",
    payload: {
      objective: "Coordinate a code change",
    },
    meta: {
      replyRequired: true,
      timeoutMs: 1_000,
    },
  })
);

const report = postmaster.createTroubleshootingReport({
  messageId: reply.replyTo,
});
```

## Core API

- `Postmaster`
- `registerAgent()` / `unregisterAgent()`
- `registerObserver()` / `unregisterObserver()`
- `listAgents()` / `listObservers()`
- `send()`
- `ping()`
- `getMessageTrace()` / `getConversationTrace()`
- `getMessageObservations()` / `getConversationObservations()`
- `createTroubleshootingReport()`

Compatibility exports like `Runtime`, `MailmanClient`, `createPacket()`, and the `mailman` CLI binary are still available.
