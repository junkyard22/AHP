import { AHPTestTraceStore } from "./logging";
import { AHPEnvelope, AHPEnvelopeKind, AHPTestDirection } from "./types";

type FaultDirection = Extract<AHPTestDirection, "workbench->ahp" | "ahp->workbench">;

type FaultControls = {
  disconnect: () => Promise<void>;
  reconnect: () => Promise<void>;
};

type FaultOperation = {
  direction: FaultDirection;
  envelope: AHPEnvelope;
};

export interface FaultInjectionRule {
  id: string;
  direction?: FaultDirection;
  kind?: AHPEnvelopeKind;
  taskId?: string;
  times?: number;
  occurrence?: number;
  delayMs?: number;
  jitterMaxMs?: number;
  duplicateCount?: number;
  duplicateSpacingMs?: number;
  drop?: boolean;
  disconnectBeforeDeliver?: boolean;
  reconnectAfterMs?: number;
}

export interface FaultInjectionConfig {
  seed?: number;
  rules?: FaultInjectionRule[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DeterministicFaultInjector {
  private readonly rules: FaultInjectionRule[];
  private readonly matchCounts = new Map<string, number>();
  private rngState: number;

  constructor(
    config: FaultInjectionConfig = {},
    private readonly traces?: AHPTestTraceStore
  ) {
    this.rules = config.rules ?? [];
    this.rngState = config.seed ?? 1;
  }

  describeRules(): string[] {
    return this.rules.map((rule) => rule.id);
  }

  async transmit(
    operation: FaultOperation,
    deliver: () => Promise<void>,
    controls: FaultControls
  ): Promise<void> {
    const matched = this.rules.filter((rule) => this.takeMatch(rule, operation));
    if (matched.length === 0) {
      await deliver();
      return;
    }

    let totalDelayMs = 0;
    let duplicateCount = 0;
    let duplicateSpacingMs = 0;
    let reconnectAfterMs = 0;
    let shouldDrop = false;
    let shouldDisconnect = false;

    for (const rule of matched) {
      const jitterMs = rule.jitterMaxMs ? this.nextInt(rule.jitterMaxMs + 1) : 0;
      totalDelayMs += (rule.delayMs ?? 0) + jitterMs;
      duplicateCount += rule.duplicateCount ?? 0;
      duplicateSpacingMs = Math.max(duplicateSpacingMs, rule.duplicateSpacingMs ?? 0);
      reconnectAfterMs = Math.max(reconnectAfterMs, rule.reconnectAfterMs ?? 0);
      shouldDrop ||= rule.drop ?? false;
      shouldDisconnect ||= rule.disconnectBeforeDeliver ?? false;

      this.recordFault(operation, rule, jitterMs);
    }

    if (shouldDisconnect) {
      await controls.disconnect();
    }

    if (reconnectAfterMs > 0) {
      await sleep(reconnectAfterMs);
      await controls.reconnect();
    }

    if (totalDelayMs > 0) {
      await sleep(totalDelayMs);
    }

    if (shouldDrop) {
      return;
    }

    await deliver();

    for (let index = 0; index < duplicateCount; index += 1) {
      if (duplicateSpacingMs > 0) {
        await sleep(duplicateSpacingMs);
      }
      await deliver();
    }
  }

  private takeMatch(rule: FaultInjectionRule, operation: FaultOperation): boolean {
    if (rule.direction && rule.direction !== operation.direction) {
      return false;
    }

    if (rule.kind && rule.kind !== operation.envelope.kind) {
      return false;
    }

    if (rule.taskId && rule.taskId !== operation.envelope.taskId) {
      return false;
    }

    const nextCount = (this.matchCounts.get(rule.id) ?? 0) + 1;
    this.matchCounts.set(rule.id, nextCount);

    if (rule.occurrence !== undefined) {
      return nextCount === rule.occurrence;
    }

    const allowed = rule.times ?? 1;
    return nextCount <= allowed;
  }

  private recordFault(
    operation: FaultOperation,
    rule: FaultInjectionRule,
    jitterMs: number
  ): void {
    if (!this.traces) {
      return;
    }

    const descriptors = [
      rule.delayMs ? `delay=${rule.delayMs}` : null,
      jitterMs ? `jitter=${jitterMs}` : null,
      rule.duplicateCount ? `duplicate=${rule.duplicateCount}` : null,
      rule.drop ? "drop" : null,
      rule.disconnectBeforeDeliver ? "disconnect" : null,
      rule.reconnectAfterMs ? `reconnect=${rule.reconnectAfterMs}` : null,
    ].filter(Boolean).join(",");

    this.traces.record({
      direction: operation.direction,
      messageId: operation.envelope.messageId,
      correlationId: operation.envelope.correlationId,
      taskId: operation.envelope.taskId,
      agentId: operation.envelope.agentId,
      sessionId: operation.envelope.sessionId,
      eventType: `fault.${rule.id}${descriptors ? `(${descriptors})` : ""}`,
      latencyMs: 0,
    });
  }

  private nextInt(maxExclusive: number): number {
    this.rngState ^= this.rngState << 13;
    this.rngState ^= this.rngState >>> 17;
    this.rngState ^= this.rngState << 5;

    const normalized = Math.abs(this.rngState) % maxExclusive;
    return normalized;
  }
}




