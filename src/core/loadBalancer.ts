// ─────────────────────────────────────────────
//  LoadBalancer
//
//  Used by runtime.sendToCapability() to pick
//  among multiple roles that share a capability.
//
//  Strategies:
//    round-robin   — cycle through candidates evenly
//    least-loaded  — pick the role with fewest active requests
// ─────────────────────────────────────────────

export type BalanceStrategy = "round-robin" | "least-loaded";

export class LoadBalancer {
  // round-robin: last chosen index per sorted candidate key
  private readonly rrCounters = new Map<string, number>();
  // least-loaded: current in-flight count per role name
  private readonly activeCounts = new Map<string, number>();

  pick(candidates: string[], strategy: BalanceStrategy = "round-robin"): string | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    return strategy === "least-loaded"
      ? this.pickLeastLoaded(candidates)
      : this.pickRoundRobin(candidates);
  }

  /** Call before dispatching to a role so least-loaded stays accurate. */
  recordStart(roleName: string): void {
    this.activeCounts.set(roleName, (this.activeCounts.get(roleName) ?? 0) + 1);
  }

  /** Call after a dispatch completes (or fails). */
  recordEnd(roleName: string): void {
    const n = this.activeCounts.get(roleName) ?? 0;
    if (n > 0) this.activeCounts.set(roleName, n - 1);
  }

  getActiveCount(roleName: string): number {
    return this.activeCounts.get(roleName) ?? 0;
  }

  // ── Strategies ────────────────────────────

  private pickRoundRobin(candidates: string[]): string {
    // Use a stable key derived from the sorted candidate list
    const key = [...candidates].sort().join("\0");
    const last = this.rrCounters.get(key) ?? -1;
    const next = (last + 1) % candidates.length;
    this.rrCounters.set(key, next);
    return candidates[next];
  }

  private pickLeastLoaded(candidates: string[]): string {
    let best = candidates[0];
    let bestCount = this.activeCounts.get(candidates[0]) ?? 0;
    for (const name of candidates.slice(1)) {
      const count = this.activeCounts.get(name) ?? 0;
      if (count < bestCount) {
        best = name;
        bestCount = count;
      }
    }
    return best;
  }
}
