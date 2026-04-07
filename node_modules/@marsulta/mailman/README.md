# Mailman

**A structured interagent messaging protocol for multi-agent systems.**

Mailman lets you send typed, validated packets between AI agents, tools, and services — inside a single process or across a multi-agent architecture. It gives every role a clear contract, every message a lifecycle, and every transaction a full trace.

[![CI](https://github.com/junkyard22/mailman/actions/workflows/ci.yml/badge.svg)](https://github.com/junkyard22/mailman/actions)
[![npm](https://img.shields.io/npm/v/@junkyard22/mailman)](https://www.npmjs.com/package/@junkyard22/mailman)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Why Mailman?

In multi-agent systems, agents need to communicate — but raw function calls have no structure, no validation, and no observability. Mailman gives every message:

- ✅ **A type** (`task.assign`, `review.request`, `health.ping`, ...)
- ✅ **A validated shape** — required fields, confidence bounds, known targets
- ✅ **A trace** — every hop is logged with actor, event, and timestamp
- ✅ **A lifecycle** — `created → validated → delivered → completed`
- ✅ **Middleware hooks** — tap into the pipeline for logging, auth, or metrics

---

## Install

```bash
npm install @junkyard22/mailman
# or
pnpm add @junkyard22/mailman
```

> **Node.js >= 18 required.**

---

## Quick Start

```ts
import { Runtime, createPacket } from "@junkyard22/mailman";

const runtime = new Runtime();
runtime.start();

// 1. Register a role with a handler
runtime.registerRole(
  {
    name: "worker",
    accepts: ["task.assign"],
    description: "Processes tasks",
  },
  async (packet) => {
    const result = String(packet.payload.prompt).toUpperCase();
    return createPacket({
      taskId: packet.taskId,
      parentPacketId: packet.packetId,
      type: "task.result",
      sender: "worker",
      target: packet.sender,
      payload: { result },
      status: "completed",
    });
  }
);

// 2. Send a packet
const reply = await runtime.send(
  createPacket({
    taskId: "task-1",
    type: "task.assign",
    sender: "orchestrator",
    target: "worker",
    payload: { prompt: "Hello, world!" },
  })
);

console.log(reply.payload.result); // "HELLO, WORLD!"
```

---

## Core Concepts

### Packet

The fundamental unit of communication. Every message is a `MailmanPacket`:

```ts
type MailmanPacket = {
  packetId: string;        // auto-generated
  taskId: string;          // links related packets
  parentPacketId?: string; // reply chain

  type: PacketType;        // see below
  sender: string;          // role name
  target: string;          // role name

  payload: Record<string, unknown>;
  status?: PacketStatus;

  // Optional
  intent?: string;
  scope?: { files?: string[]; repoWide?: boolean; artifacts?: string[] };
  constraints?: { allowNewFiles?: boolean; readOnly?: boolean; ... };
  confidence?: number;     // 0–1
  meta?: { timeoutMs?: number; replyRequired?: boolean; tags?: string[] };
  error?: { code: string; message: string };
};
```

### Packet Types

| Type | Direction | Meaning |
|---|---|---|
| `task.assign` | → agent | Assign a task |
| `task.accept` | ← agent | Agent accepted the task |
| `task.reject` | ← agent | Agent rejected the task |
| `task.result` | ← agent | Task completed, here's the output |
| `review.request` | → reviewer | Please review this result |
| `review.result` | ← reviewer | Review decision |
| `route.request` | → router | Route this packet |
| `route.result` | ← router | Routing decision |
| `error.report` | ← mailman | Something went wrong |
| `health.ping` | → agent | Are you alive? |
| `health.pong` | ← agent | Yes |

### Roles

A **role** registers a name, the packet types it accepts, and a handler function:

```ts
runtime.registerRole(
  {
    name: "reviewer",
    accepts: ["review.request"],
    description: "Reviews worker output",
    version: "1.0.0",
    health: "healthy",
  },
  async (packet) => { ... }
);
```

### Middleware

Add interceptors that wrap the packet pipeline:

```ts
// Logging middleware
runtime.use(async (packet, next) => {
  console.log("→", packet.type, packet.sender, "→", packet.target);
  const reply = await next();
  console.log("←", reply.type, reply.status);
  return reply;
});

// Auth middleware
runtime.use(async (packet, next) => {
  if (!isAuthorized(packet.sender, packet.target)) {
    throw new Error("Unauthorized");
  }
  return next();
});
```

Middleware runs in insertion order, koa-style.

### Client (fluent API)

```ts
import { Runtime, createClient } from "@junkyard22/mailman";

const client = createClient(new Runtime())
  .start()
  .registerRole({ name: "agent", accepts: ["task.assign"] }, handler);

const reply = await client.send(packet);
```

### Trace

Every packet flowing through the runtime is fully traced:

```ts
const trace = runtime.getTrace(packet.packetId);
// [
//   { event: "packet.received", actor: "mailman", timestamp: "..." },
//   { event: "packet.validated", actor: "mailman", timestamp: "..." },
//   { event: "handler.started", actor: "worker", timestamp: "..." },
//   { event: "packet.completed", actor: "mailman", timestamp: "..." },
// ]
```

---

## API Reference

### `Runtime`

| Method | Description |
|---|---|
| `start()` | Start the runtime |
| `stop()` | Stop the runtime |
| `isRunning()` | Returns whether the runtime is active |
| `use(fn)` | Register a middleware function |
| `registerRole(role, handler)` | Register an agent role |
| `unregisterRole(name)` | Remove a registered role |
| `listRoles()` | List all registered roles |
| `send(packet)` | Send a packet, returns a reply |
| `ping(roleName)` | Check if a role is alive |
| `getTrace(packetId)` | Get trace events for a packet |
| `getTaskTrace(taskId)` | Get all trace events for a task |
| `getStats()` | Get runtime stats |

### `createPacket(init)`

Factory that auto-fills `packetId` and `timestamp`. Pass any valid `MailmanPacket` fields minus those two.

### `createReply(original, type, sender, payload, overrides?)`

Build a reply packet. Automatically:
- Sets `parentPacketId` to `original.packetId`
- Inherits `taskId`
- Flips `sender` and `target`

### `createClient(runtime)`

Returns a `MailmanClient` — a fluent chainable wrapper over `Runtime`.

---

## CLI

```bash
npx mailman start    # Start the runtime
npx mailman status   # Show runtime status
npx mailman roles    # List registered roles
npx mailman inspect <packetId>  # Inspect a packet's trace
npx mailman doctor   # Run health diagnostics
```

---

## Examples

- [`examples/basic-ping`](./examples/basic-ping) — Minimal health ping/pong demo
- [`examples/task-pipeline`](./examples/task-pipeline) — Three-role orchestrator → worker → reviewer pipeline

---

## Roadmap

### Mailman v0.x (current)
- [x] In-process packet routing
- [x] Typed packet schema + validation
- [x] Full trace log
- [x] Middleware pipeline
- [x] CLI tools
- [ ] Persistent trace (SQLite)
- [ ] Cross-process transport (Unix sockets / HTTP)
- [ ] Retry + dead-letter queue

### Postmaster _(future)_

**Postmaster** is the "big brother" of Mailman — a standalone daemon that can observe
and interpret messages across entire systems, not just agents.

With Postmaster, every subsystem speaks Mailman:
- 🖨️ Printer spooler issues → `error.report` packet
- 🌐 Network/DNS failures → `error.report` packet
- 💾 Disk space warnings → `error.report` packet
- 🗄️ Database connection drops → `error.report` packet

Your agents can subscribe to infrastructure signals the same way they subscribe
to each other's messages. Postmaster makes the whole stack observable and
actionable from a single protocol.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT © junkyard22
