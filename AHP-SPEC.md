# Agent Handoff Protocol (AHP)
## Formal Specification — v0.1

**Author:** James Yarber
**Date Created:** April 1, 2026
**Status:** Draft

---

## 1. Overview

Agent Handoff Protocol is a packet-based standard for moving work between intelligent
components — orchestrators, workers, tools, and applications — with explicit ownership,
state, constraints, and completion reporting.

AHP does not standardize intelligence. It standardizes the **handoff of work**: who created
the job, who owns it now, what constraints apply, what output is expected, what state it is
in, and how it ends.

The protocol turns repeated prompt prose into reusable runtime structure. It reduces drift by
shrinking the active task context to the current unit of work instead of forcing every
component to reconstruct state from large prompt histories.

**AHP packets are to agent work what network packets are to data transfer**: a structured
unit that carries identity, destination, payload, and state in a form systems can route,
inspect, and trust.

---

## 2. Core Principles

These are not design goals. They are requirements. An implementation that violates any of
them is not AHP-compliant.

**Clear about the current job.** A receiving component must not have to guess what it owns,
what constraints apply, or what counts as done. All of that is in the packet.

**Small and relevant.** A packet carries the current assignment only. It must reduce active
context, not become another blob of repeated history and stale state.

**Strictly validated.** Packets are valid or invalid. Malformed, incomplete, or ambiguous
packets must fail at creation — not at execution.

**Explicit about ownership.** At every moment it must be clear who created the work, who
owns it now, and who is expected to act next.

**Disciplined about state.** Lifecycle transitions must be limited, legal, and recorded.
Illegal transitions must be rejected.

**Serious about terminal states.** `completed`, `failed`, `blocked`, and `cancelled` are
final. No further transitions are permitted unless a new retry packet is explicitly created.

**Capable of parent-child coordination.** Delegated work must stay linked. Parent outcomes
must be derived from child outcomes, not inferred from prose or logs.

**Explicit about failure.** Failure must not be hidden in narrative output. It must include
a reason, a type, and traceable context.

**Easy to inspect.** Every packet's lifecycle must be queryable from creation to terminal
state via the trace.

**Separated from agent identity.** Stable role prompts define how an agent behaves. AHP
defines what job the agent owns right now. These are different concerns and must stay
separate.

**Compatible with enforcement.** AHP must work naturally with gate systems so contracts can
be enforced at the boundary, not just described in the packet.

**Helpful to verification.** AHP must make it straightforward for verifier systems to
compare expected output, actual output, and trace history.

**Portable.** AHP must work across runtimes and application boundaries. It must not be
locked to any single transport, storage backend, or execution environment.

**Measured by drift reduction.** The real test is practical: less context overload, less
role confusion, less hallucinated completion, more consistent outputs.

---

## 3. Packet Schema

A compliant packet must contain all required fields at creation time. Optional fields may be
omitted at creation and populated later as the packet moves through its lifecycle.

### 3.1 Identity

Identifies the work unit and relates it to the broader run.

| Field | Type | Required | Description |
|---|---|---|---|
| `packetId` | `string` (UUID) | **Required** | Globally unique identifier for this packet. Immutable after creation. |
| `taskId` | `string` | **Required** | Logical task identifier. Used for trace grouping and deduplication across retries. |
| `runId` | `string` | Optional | Groups all packets belonging to the same orchestration run. |
| `parentPacketId` | `string` (UUID) | Optional | The `packetId` of the parent packet when this packet represents delegated work. Must be present on all child packets. |
| `createdAt` | `string` (ISO 8601) | **Required** | Timestamp of packet creation. Immutable after creation. |

### 3.2 Routing

Identifies who sent the work and who is expected to act on it.

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | `string` | **Required** | Identifier of the component that created and sent the packet. |
| `target` | `string` | **Required** | Identifier of the component expected to accept and execute the work. |
| `role` | `string` | Optional | Functional role label for the target (e.g., `BRAIN.research_worker`). Used for capability routing when the target is not statically known. |

### 3.3 Job Contract

Defines the current assignment. These fields must not be open-ended or ambiguous.

| Field | Type | Required | Description |
|---|---|---|---|
| `objective` | `string` | **Required** | The exact, narrow task this packet defines. Open-ended objectives must be rejected at validation. |
| `constraints` | `string[]` | **Required** | What the worker must not do. Must be non-empty. |
| `expectedOutput` | `string` | **Required** | The measurable condition that defines successful completion. The worker and verifier both use this field. |
| `inputs` | `string[]` | Optional | File paths, artifact IDs, or context references the worker is permitted to access. Workers must not access inputs not listed here. |

### 3.4 Lifecycle

Carries the current state of the work unit.

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | `PacketStatus` (enum) | **Required** | Current lifecycle state. See §4 for all valid values and transitions. |
| `terminalReason` | `TerminalReason` (enum) | Conditional | Required when `status` is a terminal state. Identifies the specific cause of termination. |
| `statusUpdatedAt` | `string` (ISO 8601) | **Required** | Timestamp of the most recent status transition. Must be updated on every transition. |

### 3.5 Outcome

Populated by the executing component when the packet reaches a terminal state.

| Field | Type | Required | Description |
|---|---|---|---|
| `resultSummary` | `string` | Conditional | Human-readable summary of what was produced. Required when `status` is `completed`. |
| `artifacts` | `string[]` | Optional | Output artifacts produced (file paths, IDs, or structured content references). |
| `errorCode` | `string` | Conditional | Machine-readable error code. Required when `status` is `failed`. |
| `errorMessage` | `string` | Conditional | Human-readable error description. Required when `status` is `failed`. |
| `violations` | `string[]` | Conditional | Scope or contract violations detected. Required when `status` is `blocked` due to a violation. |
| `needs` | `string[]` | Conditional | Unresolved dependencies preventing completion. Required when `status` is `blocked`. |

### 3.6 Extensions

Implementation-specific additions that must not alter the semantics of core fields.

| Field | Type | Required | Description |
|---|---|---|---|
| `meta` | `object` | Optional | Arbitrary key-value store for implementation-specific data. |
| `meta.tags` | `string[]` | Optional | Labels for routing, filtering, and trace queries. |
| `meta.retryOf` | `string` (UUID) | Optional | The `packetId` of the packet this one is retrying. Links the new packet to prior attempt history. |
| `meta.siblingPacketIds` | `string[]` | Optional | Other packets delegated alongside this one within the same parent context. |
| `meta.scheduledAt` | `string` (ISO 8601) | Optional | Requested delivery time for deferred packets. |
| `meta.ackRequired` | `boolean` | Optional | When true, the runtime must wait for an explicit acknowledgment before marking the packet `running`. |

---

## 4. Lifecycle States

### 4.1 Valid States

| State | Description |
|---|---|
| `pending` | Packet created. Not yet routed or accepted by a target. |
| `assigned` | Packet routed to a target. Target has not yet acknowledged ownership. |
| `running` | Target has accepted ownership and is actively executing the work. |
| `waiting_on_children` | Worker has delegated sub-tasks to child packets and is waiting for all children to reach a terminal state. |
| `waiting_on_tool` | Worker is waiting for a response from an external tool or capability. |
| `completed` | Work finished successfully. `resultSummary` and any `artifacts` are populated. |
| `failed` | Work ended in an unrecoverable error. `errorCode` and `errorMessage` are required. |
| `blocked` | Work cannot proceed. `needs` and/or `violations` are required to explain why. |
| `cancelled` | Work was stopped before completion by the orchestrator, parent, or gate. `terminalReason` is required. |

### 4.2 Valid Transitions

Only the transitions listed here are legal. All other transitions must be rejected.

```
pending            → assigned
pending            → running           (when no explicit assignment step)
pending            → cancelled

assigned           → running
assigned           → cancelled

running            → waiting_on_children
running            → waiting_on_tool
running            → completed
running            → failed
running            → blocked

waiting_on_children → running          (all children resolved without failure or block)
waiting_on_children → blocked          (one or more children reached blocked)
waiting_on_children → failed           (one or more children failed; none blocked)
waiting_on_children → completed        (all children completed successfully)

waiting_on_tool    → running           (tool returned a result)
waiting_on_tool    → failed            (tool returned an error or timed out)
```

### 4.3 Terminal States

`completed`, `failed`, `blocked`, and `cancelled` are terminal. Once a packet reaches a
terminal state, no further transitions are permitted. If the work must be retried, a new
packet must be created with `meta.retryOf` pointing to the original `packetId`.

### 4.4 Terminal Reason Codes

| Code | Applicable terminal states | Meaning |
|---|---|---|
| `SUCCESS` | `completed` | Work finished and output meets `expectedOutput`. |
| `EXECUTION_ERROR` | `failed` | An unrecoverable execution error occurred. |
| `TOOL_ERROR` | `failed` | An external tool returned an error or timed out. |
| `TIMEOUT` | `failed` | Execution exceeded the allowed time limit. |
| `CHILD_FAILED` | `failed` | One or more child packets failed; none were blocked. |
| `CHILD_BLOCKED` | `blocked` | One or more child packets reached `blocked`. |
| `SCOPE_VIOLATION` | `blocked` | The worker attempted to exceed its defined constraints. |
| `MISSING_INPUT` | `blocked` | A required input was not available or not listed in `inputs`. |
| `GATE_REJECTED` | `cancelled` | A pre-execution gate rejected the packet. `gateReason` in the trace. |
| `CANCELLED_BY_PARENT` | `cancelled` | The parent packet cancelled this child's work. |
| `CANCELLED_BY_ORCHESTRATOR` | `cancelled` | The orchestrator cancelled the work. |

---

## 5. Parent-Child Coordination

### 5.1 Linking

A child packet represents delegated work. Every child packet must carry `parentPacketId`
set to the `packetId` of the parent that created it.

A parent packet that has delegated work must transition to `waiting_on_children` after
creating its child packets. A parent must not transition to a terminal state while any of
its children are in a non-terminal state.

### 5.2 Child Tracking

The runtime must track the set of active (non-terminal) children for every parent packet.
When a child reaches a terminal state, the runtime must evaluate the updated child set
against the resolution rules below.

### 5.3 Parent Resolution Rules

When all children of a parent packet have reached a terminal state, the parent's terminal
state is derived as follows, in precedence order:

1. **Blocked takes precedence.** If any child is `blocked`, the parent becomes `blocked`
   with `terminalReason = CHILD_BLOCKED`. The parent's `needs` field must include the
   union of all children's `needs` and `violations`.

2. **Failed is next.** If no child is `blocked` but at least one is `failed`, the parent
   becomes `failed` with `terminalReason = CHILD_FAILED`.

3. **Completed last.** If all children are `completed`, the parent may proceed to
   `completed` (subject to its own verification, if applicable).

### 5.4 Depth Limit

Workers must not create grandchildren. Delegation depth is limited to one level below the
issuing orchestrator or head unless the packet explicitly grants deeper delegation via
`meta`. A worker that attempts to create a child packet when it is itself a child must be
rejected with `SCOPE_VIOLATION`.

---

## 6. Enforcement Integration

A **gate** is a pre-execution enforcement component that receives a packet before the
target worker processes it. The gate inspects the packet against a defined contract and
either allows or denies execution. Gates must be stateless with respect to the packet
itself — their decision is based solely on the packet's contents and the contract at the
boundary.

### 6.1 Gate Inspection Checklist

A compliant gate must check all of the following:

1. All required fields are present and non-empty.
2. `objective` is narrow and exact. Open-ended language (e.g., "do whatever is needed")
   must be rejected.
3. `constraints` is non-empty.
4. `expectedOutput` is present and measurable.
5. `target` is authorized to perform work of this type (role/capability check).
6. `inputs`, if present, are within the authorized scope for the target.
7. If `parentPacketId` is present, the parent is in a state that permits delegation.

### 6.2 Gate Outcomes

| Outcome | Effect on packet | Trace event |
|---|---|---|
| `ALLOW` | Packet proceeds to the target. Status transitions to `running`. | `gate.allow` recorded with gate identifier and timestamp. |
| `DENY` | Packet is rejected. Status → `cancelled`. `terminalReason = GATE_REJECTED`. | `gate.deny` recorded with `gateReason` explaining the rejection. |

### 6.3 Gate Placement

Gates must be positioned at the boundary between the issuing component and the receiving
worker. They must not be bypassed. The gate decision must be recorded in the packet trace
before execution begins.

---

## 7. Verification Integration

A **verifier** is a post-execution inspection component that receives a terminal packet and
evaluates whether the work was done correctly. The verifier has access to the full packet,
the result, and the trace.

### 7.1 Verifier Inspection Checklist

A compliant verifier must inspect all of the following:

1. **Contract compliance.** Does `resultSummary` and/or `artifacts` satisfy
   `expectedOutput`?
2. **Constraint compliance.** Do the outputs and trace show no constraint violations?
3. **Scope compliance.** Did the worker stay within its authorized `inputs` and `role`?
4. **Depth compliance.** Did the worker avoid unauthorized child packet creation?
5. **Trace completeness.** Is the trace present, ordered, and complete from creation to
   terminal state?

### 7.2 Verification Verdicts

| Verdict | Meaning | Allowed next action |
|---|---|---|
| `PASS` | Output meets `expectedOutput`. No violations. Trace is complete. | Result may be forwarded or accepted. |
| `FAIL` | Output does not meet `expectedOutput`. No violation present. | Orchestrator may create a retry packet. |
| `VIOLATION` | One or more constraints were violated. | Packet status must be forced to `blocked` with `SCOPE_VIOLATION`. Result must not be forwarded. |
| `INCONCLUSIVE` | Verifier could not determine pass or fail (e.g., missing trace, ambiguous output). | Orchestrator must not forward the result. Treat as `FAIL` for routing purposes. |

### 7.3 Forced Status Override

When a verifier returns `VIOLATION`, it may force the packet's status to `blocked` even if
the executing component already reported `completed`. The verifier's override takes
precedence. The forced transition must be recorded in the trace with `actor` set to the
verifier's identifier.

---

## 8. Trace Requirements

A compliant trace is an append-only, ordered log of events across a packet's full
lifecycle. Traces must be queryable by `packetId` and by `taskId`.

### 8.1 Required Trace Events

The following events must be recorded by a compliant runtime:

| Event | When it fires | Required fields in event record |
|---|---|---|
| `packet.created` | Packet is created | Full initial packet snapshot |
| `packet.assigned` | Packet is routed to a target | `target`, `role` if present |
| `packet.status_changed` | Any status transition | `fromStatus`, `toStatus`, `actor` |
| `gate.allow` | Gate permits execution | `gateId`, `checklist` summary |
| `gate.deny` | Gate rejects execution | `gateId`, `gateReason` |
| `packet.child_created` | A child packet is created | `childPacketId`, `childTaskId` |
| `packet.child_resolved` | A child packet reaches terminal state | `childPacketId`, `childStatus`, `childTerminalReason` |
| `tool.invoked` | Worker calls an external tool | `toolName`, `toolInputSummary` |
| `tool.returned` | External tool returns | `toolName`, `toolStatus` |
| `verification.verdict` | Verifier produces a verdict | `verifierId`, `verdict`, `notes` |
| `packet.terminal` | Packet reaches any terminal state | `finalStatus`, `terminalReason` |

### 8.2 Trace Event Structure

Every trace event must include:

| Field | Type | Description |
|---|---|---|
| `eventId` | `string` (UUID) | Unique identifier for this trace event. |
| `packetId` | `string` (UUID) | The packet this event belongs to. |
| `taskId` | `string` | The task this packet belongs to. |
| `event` | `string` | Event type (from the table above). |
| `actor` | `string` | The component that triggered this event. |
| `timestamp` | `string` (ISO 8601) | When the event occurred. |
| `details` | `object` | Optional key-value details specific to the event type. |

### 8.3 Trace Integrity Rules

- Events must be appended only. No event may be deleted or modified after it is written.
- Events must be ordered by `timestamp`. If timestamps collide, insertion order governs.
- A terminal event must be the last event in a packet's trace.
- Trace gaps (missing required events) make a trace non-compliant. Verifiers must flag
  incomplete traces as `INCONCLUSIVE`.

---

## 9. Portability and Implementation Requirements

### 9.1 What Any Runtime Must Implement

To be AHP-compliant, a runtime must provide:

1. **Packet creation with validation.** All required fields must be validated at creation
   time. Packets with missing or invalid required fields must be rejected before they enter
   the lifecycle.

2. **Lifecycle state machine.** The runtime must enforce valid transitions only. Illegal
   transition attempts must be rejected and the packet must remain in its current state.

3. **Terminal state finality.** The runtime must prevent any transition out of a terminal
   state except via explicit retry packet creation.

4. **Trace store.** An append-only store that accepts trace events and supports queries
   by `packetId` and `taskId`. The store may be in-memory, file-based, or backed by a
   database; the query contract is what matters.

5. **Parent-child linkage.** The runtime must track children for every parent packet and
   apply the resolution rules in §5.3 when the last child reaches a terminal state.

6. **Gate integration point.** The runtime must provide a hook position before execution
   where a gate can inspect the packet and return ALLOW or DENY. Skipping the gate hook
   must be an explicit opt-in, not a default.

7. **Verifier integration point.** The runtime must provide a hook position after a packet
   reaches a terminal state where a verifier can inspect the packet and trace.

### 9.2 What Is Not Required

AHP does not mandate:

- A specific transport protocol. HTTP, WebSocket, gRPC, message queues, and in-process
  function calls are all valid.
- A specific serialization format. JSON is recommended. Any format that can represent the
  schema faithfully is permitted.
- A specific storage backend for the trace store.
- A specific gate or verifier implementation. Gates and verifiers are extension points, not
  core components.
- Any particular runtime language or framework.

### 9.3 Versioning

Every packet must carry the AHP version it was created under if implementations span
multiple versions. The field `ahpVersion` (string, e.g., `"0.1"`) in `meta` is the
recommended location. Runtimes that support multiple versions must handle or reject
cross-version packets explicitly.

---

## 10. Reference Summary

> **Prompts define the worker.**
> **AHP delivers the work.**
> **Gates enforce the rules.**
> **Verification checks the result.**

A packet carries one unit of work from the component that created it to the component that
must complete it. It names the job, constrains the worker, declares the expected output,
tracks every state transition, and records the result — in a form every system in the chain
can read, route, inspect, and trust.

If a component cannot determine what it owns, what the rules are, or what done looks like
from the packet alone, the packet is malformed.
