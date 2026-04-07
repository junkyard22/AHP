# AHP Test Harness

This folder contains an isolated communication verification harness for AHP semantics. It is not a new runtime path, app flow, or UI feature.

## Isolation

- All harness code lives under `src/experimental/ahp-test-harness/`.
- Activation is explicit: `AHP_TEST_MODE=true`.
- When test mode is off, `createAHPTestHarness()` returns `null` and no existing runtime path is touched.
- No production entrypoint was replaced or rewired.
- The harness supports two transport modes without changing the event or envelope model:
  - `in-memory`
  - `local` (WebSocket over localhost)

## Transport Layers

- `InMemoryTransport`: direct in-process delivery used as the semantic baseline.
- `LocalTransport`: real localhost WebSocket boundary used for transport-backed verification.
- `DeterministicFaultInjector`: seeded, rule-driven transport fault injection for the local transport.

## Fault Injection

The fault injector can deterministically simulate:

- delayed delivery
- duplicated envelopes
- dropped non-terminal envelopes
- out-of-order delivery
- transient disconnect/reconnect
- retry race windows

Fault rules are transport-local and do not change the canonical AHP event model.
Each applied fault is logged into the harness trace as a `fault.*` event for the affected task.

## Message Flow

1. `MaestroTestAdapter.sendTask()` records a `maestro->workbench` hop.
2. `AHPTestBus` assigns retries, ack/inactivity timers, and per-task sequence numbers.
3. The selected transport sends `workbench->ahp` envelopes.
4. `AHPTestAgentHost` executes the test agent handler and emits `ahp->workbench` envelopes.
5. `AHPTestBus` deduplicates by `messageId`, maps envelopes to canonical events, and emits `workbench->maestro` events.
6. `traceTask(taskId)` returns the structured hop log for that task, including injected fault actions.

## Verified Semantics

The semantic and fault suites verify:

- routing and addressing
- correlation IDs across hops
- request/response
- streaming progress and partial outputs
- error propagation
- cancellation and idempotent cancel
- reconnect after Workbench restart
- duplicate-message dedupe by `messageId`
- ordering via monotonic per-task `sequence`
- out-of-order late-envelope suppression after terminal delivery
- idempotent retry behavior with max 2 retries
- terminal-state monotonicity under transport faults

## Event Contract

The harness emits only these test-path events:

- `TASK_ACCEPTED`
- `TASK_PROGRESS`
- `TASK_PARTIAL_OUTPUT`
- `TASK_COMPLETED`
- `TASK_FAILED`
- `TASK_CANCELLED`
- `AGENT_ONLINE`
- `AGENT_OFFLINE`

Every emitted event includes:

- `taskId`
- `agentId`
- `sessionId`
- `timestamp`
- `sequence`
- `messageId`
- `correlationId`

## Structured Trace Fields

Each hop log records:

- `direction`
- `messageId`
- `correlationId`
- `taskId`
- `agentId`
- `sessionId`
- `eventType`
- `latencyMs`

## Run Commands

Enable test mode in PowerShell:

```powershell
$env:AHP_TEST_MODE = 'true'
```

Run the in-memory semantic baseline:

```powershell
npm.cmd test -- src/experimental/ahp-test-harness/__tests__/protocolVerification.test.ts
```

Run the real localhost transport suite:

```powershell
npm.cmd test -- src/experimental/ahp-test-harness/__tests__/localTransport.test.ts
```

Run the real localhost fault-injection suite:

```powershell
npm.cmd test -- src/experimental/ahp-test-harness/__tests__/localTransportFaults.test.ts
```

Run every harness suite:

```powershell
npm.cmd test -- src/experimental/ahp-test-harness/__tests__
```

Full regression check:

```powershell
npm.cmd test
npm.cmd run build
```

## Disable Test Mode

PowerShell:

```powershell
Remove-Item Env:\AHP_TEST_MODE -ErrorAction SilentlyContinue
```

Or set it explicitly off:

```powershell
$env:AHP_TEST_MODE = 'false'
```
