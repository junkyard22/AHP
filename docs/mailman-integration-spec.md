# Spec: Mailman Integration — Observability Bridge + Packet-Driven Orchestration

> **Status:** Phase 1 ✅ Shipped · Phase 2 ✅ Shipped (feature-flagged)
> **Repo:** `YakStacks/maestro` — `src/mailman/`

---

## Overview

Two-phase integration of [Mailman](https://github.com/junkyard22/Mailman) — a typed
packet-based messaging library — into Maestro. The goal is to graduate Maestro's subagent
lifecycle from ad-hoc event emissions toward an explicit, traceable, packet-driven execution
model without breaking or replacing any existing orchestration path.

---

## Background

Maestro's current subagent lifecycle emits events through a typed `EventEmitter` singleton
(`MaestroEventBus`) but has no persistent trace, no explicit packet ownership, and no way to
derive orchestration outcomes from message state. Mailman provides all of that infrastructure
as a library dependency. These phases wire it in surgically.

---

## Phase 1 — Observability Bridge

**File:** `src/mailman/bridge.ts`
**Tests:** `src/mailman/__tests__/bridge.test.ts` (11 tests)

### Purpose

Non-invasive sidecar that mirrors every `MaestroEventBus` emission into a Mailman `Runtime`
for tracing and replay. Zero changes to `spawner.ts`, `registry.ts`, `merger.ts`, or
`events.ts`.

### Event mapping

| Maestro event | Mailman packet type | Notes |
|---|---|---|
| `subagent:spawned` | `task.assign` | sender = head, target = worker |
| `subagent:complete` (OK/ERROR) | `task.result` | payload carries `status` |
| `subagent:complete` (BLOCKED) | `task.reject` | custom type |
| `subagent:blocked` | `task.nack` | payload carries `needs[]` |
| `subagent:violation` | `error.report` | payload carries `violations[]` |
| `head:merge_conflict` | `head.merge_conflict` | custom type |

### Query API

```ts
const bridge = new MailmanBridge();
bridge.attach();                    // start mirroring Maestro events
bridge.detach();                    // stop mirroring

bridge.getRunTrace(runId)           // MaestroTraceEntry[]
bridge.allRunIds()                  // string[]
bridge.getRawTrace(runId)           // MailmanTraceEntry[] (raw)
bridge.getRuntime()                 // Mailman Runtime instance (pub/sub, custom subscriptions)
```

### Test coverage

- Per-event packet shape assertions for all 5 event types
- Full 3-worker run trace (spawn → complete → complete → complete)
- Pub/sub fan-out via `task.*` wildcard
- Wildcard `*` filtering
- Capability routing
- `detach()` stops mirroring
- Raw trace access

---

## Phase 2 — Packet-Driven Orchestration Pilot

**File:** `src/mailman/orchestrator.ts`
**Tests:** `src/mailman/__tests__/orchestrator.test.ts` (25 tests)

### Purpose

Promote the `spawnWorker → receiveWorkerResult` cycle from event-mirroring to genuine
packet-driven execution. When the feature flag is ON, **packet state transitions drive
parent resolution** — not just observe it.

### Feature flag

```bash
MAESTRO_MAILMAN_PACKET_DRIVEN=1   # OFF by default
```

When OFF, `packetAwareSpawnWorker` and `packetAwareReceiveWorkerResult` fall through to the
original functions with zero overhead and zero packet records created.

### Packet model

```
ROOT packet  (1 per head per orchestration round)
  taskId:          "root:<HeadRole>"
  type:            "root"
  status lifecycle: pending → running → waiting_on_children → completed | failed | blocked

CHILD packet  (1 per spawned worker task)
  taskId:          <task_id from spawnWorker()>
  type:            "child"
  parentPacketId:  → ROOT.packetId   ← explicit parent/child linkage
  status lifecycle: running → completed | failed | blocked
```

### Status transition rules

| Child outcome | Child status | Root status (when last worker done) |
|---|---|---|
| `violations.length > 0` | `blocked` | `blocked` |
| `envelope.status === 'OK'` | `completed` | `completed` |
| `envelope.status === 'BLOCKED'` | `blocked` | `blocked` |
| `envelope.status === 'ERROR'` | `failed` | `failed` |
| Any child `blocked` + other `failed` | `blocked` | `blocked` (blocked > failed) |

### Drop-in dispatch functions

```ts
import {
  packetAwareSpawnWorker,
  packetAwareReceiveWorkerResult,
} from '../mailman/orchestrator';

// Identical signatures and return types to the originals
const spawnResult = packetAwareSpawnWorker(state, task, fileContents);
const workerResult = packetAwareReceiveWorkerResult(state, task_id, rawOutput);
```

Heads call these instead of `spawnWorker` / `receiveWorkerResult` directly. The flag
selection is transparent to the caller.

### Internal lifecycle (flag ON)

```
packetAwareSpawnWorker()
  1. Call originalSpawnWorker()         ← guards, active_workers, eventBus unchanged
  2. If rejected → return SpawnResult unchanged
  3. Ensure root packet exists for state.head (create if first spawn in round)
  4. Transition root:  running → waiting_on_children
  5. Create child packet with parentPacketId = root.packetId
  6. Publish task.assign packet to Mailman runtime
  7. Return original SpawnResult (shape unchanged)

packetAwareReceiveWorkerResult()
  1. Call originalReceiveWorkerResult()  ← validation, active_workers.delete, eventBus
  2. Derive child status from violations + rawOutput.status
  3. Transition child to final status
  4. Publish task.result packet
  5. If state.active_workers.size === 0:
       → Compute root status from blocked/failed/completed workers
       → Transition root to final status
       → Publish worker.result packet (root resolved)
  6. Return original WorkerResult (shape unchanged)
```

### Non-goals

- Does **not** replace existing `eventBus` emissions
- Does **not** change `SpawnResult` or `WorkerResult` shapes
- Does **not** modify `spawner.ts`, `registry.ts`, `merger.ts`, or `events.ts`
- Does **not** broaden beyond Maestro (Mailman stays a pure library dependency)

### Test coverage (25 tests, 8 suites)

| Suite | What it proves |
|---|---|
| `feature flag` | Default OFF; enabled by `MAESTRO_MAILMAN_PACKET_DRIVEN=1` |
| `flag OFF regression` | Same output, zero packet records created |
| `root packet creation` | Created on first spawn; reused across multiple spawns in round |
| `child packet creation` | Unique `packetId`; `parentPacketId` points to root |
| `successful child flow` | Child → completed; root → completed; root waits while workers active |
| `failed/blocked child flow` | ERROR→failed; BLOCKED→blocked; blocked takes precedence over failed |
| `trace lifecycle` | Mailman trace entries written; pub/sub `task.*` fan-out confirmed |
| `flag selection` | Dispatch functions route to correct path based on env flag |

---

## Architecture

```
Maestro Head (e.g. BRAIN)
  │
  ├── packetAwareSpawnWorker()           ← drop-in replacement
  │     ├── originalSpawnWorker()        ← guards, eventBus, HeadState [UNCHANGED]
  │     └── PacketDrivenOrchestrator     ← packet tracking (flag ON only)
  │           ├── ROOT packet            ← 1 per head, tracks orchestration round
  │           └── CHILD packet           ← 1 per worker, parentPacketId → root
  │
  └── packetAwareReceiveWorkerResult()   ← drop-in replacement
        ├── originalReceiveWorkerResult() ← validation, eventBus [UNCHANGED]
        └── PacketDrivenOrchestrator      ← status transitions + root resolution

MailmanBridge  (Phase 1, always-on observability)
  └── eventBus.on(every MaestroEvent) → runtime.publish(packet) → MemoryTraceStore
```

---

## File inventory

| File | Lines | Description |
|---|---|---|
| `src/mailman/bridge.ts` | ~160 | Phase 1: observability sidecar |
| `src/mailman/orchestrator.ts` | ~270 | Phase 2: pilot + dispatch functions |
| `src/mailman/__tests__/bridge.test.ts` | ~220 | 11 bridge tests |
| `src/mailman/__tests__/orchestrator.test.ts` | ~340 | 25 orchestrator tests |

---

## Definition of done

- [x] Feature flag OFF → current default behavior byte-for-byte identical
- [x] Feature flag ON → root + child packets created with correct linkage
- [x] Packet state drives parent resolution (not just mirrors events)
- [x] `SpawnResult` / `WorkerResult` return shapes unchanged
- [x] Zero changes to `spawner.ts`, `registry.ts`, `merger.ts`, `events.ts`
- [x] 36/36 tests pass (`bridge`: 11, `orchestrator`: 25)
- [x] Committed and pushed: `YakStacks/maestro` @ `742e0df`

---

## Mailman library dependency

- Repo: <https://github.com/junkyard22/Mailman>
- Commit used: `0667c38` (v0.3)
- Key exports: `Runtime`, `MemoryTraceStore`, `MemoryDLQStore`, `newPacketId`, `now`
