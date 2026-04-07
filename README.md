# Agent Handoff Protocol (AHP)

> *Prompts define the worker. AHP delivers the work.*

**Agent Handoff Protocol (AHP)** is a packet-based protocol for explicit agent task handoff, lifecycle state management, and completion reporting. It defines how work is handed off, tracked, constrained, and resolved between intelligent components — not how those components think.

**Prior art established:** 2025  
**Author:** James Yarber  
**Status:** Specification complete — TypeScript implementation available

---

## The Problem

Most multi-agent systems drift because they overload context. Each worker receives long prompt history, repeated role setup, stale state, mixed instructions, and buried constraints. That increases ambiguity, and ambiguity raises hallucination risk.

The job gets lost between handoff and completion.

## The Idea

AHP treats work the way network systems treat data: as a structured unit with identity, destination, payload, and rules.

> Traditional network packets move bytes. AHP packets move responsibility.

Instead of:
> "Here is the entire conversation history, figure out what you're supposed to do."

AHP makes it:
> "Here is your current objective, your constraints, your expected output, and your lifecycle state. Nothing else."

## How It Works

| Step | What Happens |
|------|-------------|
| 1 | A root packet is created with task ID, objective, constraints, expected output, and initial state |
| 2 | The packet is routed to a recipient by worker identity, role, or capability — ownership becomes explicit |
| 3 | The recipient works the packet while lifecycle state stays visible: `ready`, `running`, `waiting`, `completed`, `failed`, `blocked`, `cancelled` |
| 4 | Child packets can be spawned for delegation — parent-child relationships remain traceable |
| 5 | Results are returned through packet outcome, not buried in freeform chat text |
| 6 | Parent resolution follows child outcomes — no log archaeology required |

## Prompt-Heavy Handoff vs. AHP

| Prompt-Heavy | AHP |
|-------------|-----|
| Role and intent restated repeatedly | Role stays stable; packet carries the current job |
| Current job must be inferred from prose | Task ownership and constraints are explicit |
| Old and new state blur together | Current state is separate from stale history |
| Completion relies on model self-report | Completion tied to runtime state and verification |
| Troubleshooting requires log archaeology | Packet lifecycle is inspectable end to end |

## What AHP Must Be

| Property | Meaning |
|----------|---------|
| **Clear** | A receiving component should not have to guess what task it owns, what constraints apply, or what output is expected |
| **Small** | Active context stays tight and relevant — not a dumping ground for stale history |
| **Strict** | A packet is valid or invalid — required fields, allowed values, and shape validation are enforceable |
| **Owned** | At any moment it is obvious who created the packet, who owns it, and who acts next |
| **Stateful** | Lifecycle transitions are explicit and legal — impossible or contradictory moves are rejected |
| **Terminal** | Completed, failed, blocked, and cancelled are real final states |
| **Traceable** | The packet lifecycle is inspectable from creation through resolution |
| **Portable** | Works across runtimes and applications — not tied to one narrow architecture |
| **Gate-friendly** | Pairs naturally with enforcement systems so the contract is checked, not just described |
| **Verifier-friendly** | Makes it easy to inspect expected output, actual result, failure reason, and trace history |

## The Stack Around AHP

AHP is most powerful when it is not working alone:

```
┌─────────────────────────────────────┐
│  Prompts define the worker          │  ← stable role identity
├─────────────────────────────────────┤
│  AHP carries the job                │  ← this protocol
├─────────────────────────────────────┤
│  Enforcement gates check the rules  │  ← e.g. Miranda-style budget/permission gates
├─────────────────────────────────────┤
│  Verifier checks the result         │  ← e.g. Pappy-style acceptance criteria
└─────────────────────────────────────┘
```

## What AHP Standardizes

- Task handoff
- Packet identity
- Parent-child relationships
- Status transitions
- Completion and failure reporting
- Traceability and inspection

## What AHP Does Not Standardize

- Model intelligence
- Prompt-writing style
- Tool implementation details
- Memory systems
- UI presentation

## Getting Started

```bash
npm install @junkyard22/ahp
```

See [`AHP-SPEC.md`](./AHP-SPEC.md) for the full protocol specification and [`examples/`](./examples) for working implementations.

## Repository Structure

```
AHP/
├── AHP-SPEC.md          ← Full protocol specification
├── src/                 ← TypeScript implementation
├── examples/            ← Working integration examples
├── docs/                ← Extended documentation
└── CHANGELOG.md
```

## Prior Art

Agent Handoff Protocol was conceived and developed in 2025 as an original architectural contribution. It is published as a defensive publication to establish prior art and prevent third parties from obtaining exclusive rights to this concept.

The novelty is not inventing structured messaging or state machines. The novelty is applying a packet-based transport model specifically to agent task handoff, with explicit lifecycle state, parent-child traceability, and first-class support for enforcement gates and result verification in multi-agent AI systems.

---

*Agent Handoff Protocol: packets move bytes — AHP moves responsibility.*
