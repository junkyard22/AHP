# Agent Handoff Protocol (AHP)

> *Traditional network packets move bytes. AHP packets move responsibility.*

**Agent Handoff Protocol (AHP)** is an open, packet-based protocol for handing work between intelligent components — with explicit ownership, enforced constraints, traceable lifecycle, and verifiable completion.

AHP is not an AI protocol. It is a **work protocol** that any intelligent system can implement.

**Prior art established:** 2025  
**Author:** James Yarber  
**Status:** Specification complete — TypeScript implementation available

[![CI](https://github.com/junkyard22/AHP/actions/workflows/ci.yml/badge.svg)](https://github.com/junkyard22/AHP/actions)
[![npm](https://img.shields.io/npm/v/@marsulta/mailman)](https://www.npmjs.com/package/@marsulta/mailman)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/junkyard22/AHP/blob/main/LICENSE)

---

## The Problem

Every complex system — whether it runs AI agents, enterprise services, hospital workflows, or server infrastructure — has the same fundamental problem:

**Work gets lost between handoff and completion.**

A worker receives a wall of context and has to guess what it's supposed to do. Ownership is implied, not explicit. State is buried in logs. When something fails, nobody knows who was responsible or why.

Multi-agent AI systems have made this worse. Agents are handed long conversation histories, repeated role setup, stale state, and mixed instructions. Ambiguity rises. Hallucination risk rises. The job gets lost.

The same problem exists outside of AI entirely:

- An enterprise service hands off an approval request with no defined owner
- A hospital workflow routes a credentialing task with no audit trail
- A server daemon reports a failure with no structured lifecycle
- A microservice delegates work with no way to verify completion

**The handoff is always the weak point.**

---

## The Idea

AHP treats work the way network systems treat data: as a **structured unit with identity, destination, payload, and rules**.

Instead of:
> *"Here is the entire conversation history, figure out what you're supposed to do."*

AHP makes it:
> *"Here is your objective, your constraints, your expected output, and your lifecycle state. Nothing else."*

At any moment in an AHP system, you know:

- **Who owns this task right now**
- **What constraints apply**
- **What state the task is in**
- **What happened if it failed**
- **What the full trace looks like from creation to resolution**

---

## AHP Works Everywhere Work Gets Handed Off

AHP is domain agnostic. The packet carries responsibility — and responsibility does not care what the worker is.

| Domain | Sender | Recipient | Packet Carries |
|---|---|---|---|
| AI coding pipeline | Orchestrator | Coder agent | Implement this function, no new files |
| Healthcare credentialing | Intake system | Credentialing agent | Verify this provider against CARF standards |
| Enterprise approval | Request service | Compliance gate | Review this policy change, block on failure |
| Server infrastructure | Monitoring daemon | Repair agent | Disk at 94%, remediate before threshold |
| Legal review | Document system | Review agent | Check this contract against current statute |
| Customer service | Triage system | Specialist agent | Escalate, customer tier 1, response SLA 2hr |

Same protocol. Different workers. Same ownership, same lifecycle, same traceability.

---

## How It Works

| Step | What Happens |
|---|---|
| 1 | A root packet is created with task ID, objective, constraints, expected output, and initial state |
| 2 | The packet is routed to a recipient by worker identity, role, or capability — ownership is explicit |
| 3 | The recipient works the packet while lifecycle state stays visible: `ready → running → waiting → completed / failed / blocked / cancelled` |
| 4 | Child packets can be spawned for delegation — parent-child relationships remain traceable |
| 5 | Results are returned through packet outcome, not buried in freeform text |
| 6 | Parent resolution follows child outcomes — no log archaeology required |

---

## The Stack Around AHP

AHP is most powerful when it is not working alone:

```
┌─────────────────────────────────────┐
│  Prompts / config define the worker │  ← stable role identity
├─────────────────────────────────────┤
│  AHP carries the job                │  ← this protocol
├─────────────────────────────────────┤
│  Enforcement gates check the rules  │  ← budget / permission / compliance gates
├─────────────────────────────────────┤
│  Verifier checks the result         │  ← acceptance criteria, QC verdicts
└─────────────────────────────────────┘
```

---

## Packet Structure

Every unit of work in AHP is a packet:

```typescript
type AHPPacket = {
  packetId: string;         // unique identity
  taskId: string;           // links related packets
  parentPacketId?: string;  // delegation chain

  type: PacketType;         // task.assign, review.request, error.report, health.ping, ...
  sender: string;           // who sent it
  target: string;           // who owns it now

  payload: Record<string, unknown>;
  status?: PacketStatus;    // ready | running | waiting | completed | failed | blocked | cancelled

  intent?: string;
  constraints?: {
    allowNewFiles?: boolean;
    readOnly?: boolean;
    timeoutMs?: number;
  };
  confidence?: number;      // 0–1
  error?: { code: string; message: string };
};
```

---

## Packet Types

| Type | Direction | Meaning |
|---|---|---|
| `task.assign` | → worker | Assign a task with constraints and expected output |
| `task.accept` | ← worker | Worker accepted ownership |
| `task.reject` | ← worker | Worker rejected, reason included |
| `task.result` | ← worker | Task completed, result attached |
| `review.request` | → reviewer | Review this result |
| `review.result` | ← reviewer | Verdict with reason |
| `route.request` | → router | Route this packet to the right worker |
| `route.result` | ← router | Routing decision |
| `error.report` | ← system | Structured failure with trace |
| `health.ping` | → worker | Liveness check |
| `health.pong` | ← worker | Alive and ready |

---

## Quick Start

```bash
npm install @junkyard22/ahp
```

```typescript
import { Runtime, createPacket } from "@junkyard22/ahp";

const runtime = new Runtime();
runtime.start();

// Register a worker role
runtime.registerRole(
  {
    name: "python-specialist",
    accepts: ["task.assign"],
    description: "Handles Python implementation tasks",
  },
  async (packet) => {
    // do the work
    return createPacket({
      taskId: packet.taskId,
      parentPacketId: packet.packetId,
      type: "task.result",
      sender: "python-specialist",
      target: packet.sender,
      payload: { result: "implementation complete" },
      status: "completed",
    });
  }
);

// Send a task packet
const reply = await runtime.send(
  createPacket({
    taskId: "task-001",
    type: "task.assign",
    sender: "orchestrator",
    target: "python-specialist",
    payload: { prompt: "Implement the auth middleware" },
    constraints: { allowNewFiles: false, timeoutMs: 30000 },
  })
);
```

---

## Prompt-Heavy Handoff vs. AHP

| Prompt-Heavy | AHP |
|---|---|
| Role and intent restated on every handoff | Role stays stable — packet carries the current job |
| Current objective inferred from prose | Task ownership and constraints are explicit |
| Old and new state blur together | Current state is separate from history |
| Completion relies on model self-report | Completion tied to runtime lifecycle state |
| Failure requires log archaeology | Packet trace is inspectable end to end |
| Domain-specific glue code on every integration | One protocol, any worker, any domain |

---

## What AHP Standardizes

- Task handoff and ownership transfer
- Packet identity and shape validation
- Parent-child delegation relationships
- Lifecycle state transitions
- Completion, failure, and blocked reporting
- Full traceability from creation to resolution

## What AHP Does Not Standardize

- Model intelligence or prompt design
- Tool implementation details
- Memory or storage systems
- UI or presentation layer
- Transport mechanism (in-process, HTTP, sockets — your choice)

---

## Lifecycle States

```
created → validated → ready → running → waiting → completed
                                    ↘ failed
                                    ↘ blocked
                                    ↘ cancelled
```

State transitions are explicit and enforced. Impossible or contradictory moves are rejected at the runtime level.

---

## CLI

```bash
npx ahp start                      # Start the runtime
npx ahp status                     # Show runtime status
npx ahp roles                      # List registered roles
npx ahp inspect <packetId>         # Inspect a packet's full trace
npx ahp doctor                     # Run health diagnostics
```

---

## Middleware

AHP supports middleware hooks that wrap the packet pipeline for logging, auth, metrics, or enforcement:

```typescript
// Enforcement gate — block packets that exceed budget
runtime.use(async (packet, next) => {
  if (packet.constraints?.timeoutMs > MAX_ALLOWED_TIMEOUT) {
    throw new Error("Packet exceeds allowed timeout budget");
  }
  return next();
});
```

---

## Postmaster *(future)*

**Postmaster** is the infrastructure layer of AHP — a standalone daemon that makes entire systems observable through a single protocol.

With Postmaster, every subsystem speaks AHP:

- 🖨️ Printer spooler failure → `error.report` packet
- 🌐 DNS resolution failure → `error.report` packet  
- 💾 Disk space warning → `error.report` packet
- 🗄️ Database connection drop → `error.report` packet
- 🔒 Auth service degraded → `error.report` packet

Your agents, services, and infrastructure all speak the same language. Postmaster makes the whole stack observable, routable, and actionable from a single protocol — whether the worker receiving that packet is an AI agent, an automated remediation service, or a human operator.

---

## Repository Structure

```
AHP/
├── AHP-SPEC.md          ← Full protocol specification
├── AHP-README.md        ← Extended protocol documentation
├── src/                 ← TypeScript implementation
├── examples/            ← Working integration examples
│   ├── basic-ping       ← Minimal health ping/pong
│   └── task-pipeline    ← Orchestrator → worker → reviewer
├── docs/                ← Extended documentation
└── CHANGELOG.md
```

---

## Prior Art

Agent Handoff Protocol was conceived and developed in 2025 as an original architectural contribution. It is published as a defensive publication to establish prior art and prevent third parties from obtaining exclusive rights to this concept.

The novelty is not inventing structured messaging or state machines. The novelty is applying a packet-based transport model specifically to agent task handoff — with explicit lifecycle state, parent-child traceability, domain-agnostic design, and first-class support for enforcement gates and result verification across any system where work is handed between intelligent components.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT © James Yarber

---

*Prompts define the worker. AHP delivers the work.*
