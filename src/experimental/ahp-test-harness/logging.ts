import { elapsedMs, now } from "../../utils/time";
import { AHPTestDirection, AHPTestLogEntry } from "./types";

export class AHPTestTraceStore {
  private readonly entries: AHPTestLogEntry[] = [];

  record(entry: Omit<AHPTestLogEntry, "timestamp"> & { timestamp?: string }): AHPTestLogEntry {
    const normalized: AHPTestLogEntry = {
      ...entry,
      timestamp: entry.timestamp ?? now(),
    };

    this.entries.push(normalized);
    return normalized;
  }

  recordHop(params: {
    direction: AHPTestDirection;
    messageId: string;
    correlationId: string;
    taskId: string;
    agentId: string;
    sessionId: string;
    eventType: string;
    startedAt?: string;
  }): AHPTestLogEntry {
    return this.record({
      ...params,
      latencyMs: params.startedAt ? elapsedMs(params.startedAt) : 0,
    });
  }

  all(): AHPTestLogEntry[] {
    return [...this.entries];
  }

  byTaskId(taskId: string): AHPTestLogEntry[] {
    return this.entries.filter((entry) => entry.taskId === taskId);
  }
}
