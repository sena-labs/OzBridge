/**
 * v1.0 deliverable R — activation performance budget.
 *
 * Asserts that the synchronous portion of `activate()` consistently
 * stays under the published budget on the CI runner. We measure the
 * `performance.now()` delta around the call (deactivating between
 * iterations to keep state clean) and check both p50 and p95 against
 * the budget. The mocked `vscode` host means timings reflect the
 * extension's own work, not the editor's.
 *
 * If this test starts flaking on slow runners, raise
 * {@link BUDGETS.p95Ms} *deliberately* in the same PR that introduces
 * the regression — never silently disable the assertion.
 */
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

/**
 * Budget envelope, in milliseconds.
 *
 * **These are measurement-environment budgets, not user-facing
 * latency.** They guard against *catastrophic regressions* under the
 * vitest harness with the mocked `vscode` host (which itself adds
 * fixed overhead absent on the real editor). Real activate() time on
 * a stable VS Code build is ~5× faster than what we observe here.
 *
 * Aligned with `docs/MILESTONE-v1.0.md` deliverable R: the public
 * promise is `activate < 200 ms` on the editor. The CI-side
 * envelope below is calibrated so that a 2× slowdown of the
 * synchronous path will trip the gate.
 *
 * If the budget needs to grow, do it **deliberately** in the same
 * PR that introduces the regression — never silently disable the
 * assertion.
 */
export const BUDGETS = {
  p50Ms: 800,
  p95Ms: 1500,
  iterations: 25,
} as const;

function createMockExtensionContext() {
  return {
    extensionUri: { fsPath: '/ext', scheme: 'file', toString: () => 'file:///ext' },
    subscriptions: [] as Array<{ dispose: () => void }>,
  };
}

function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  const idx = Math.min(sortedAsc.length - 1, Math.ceil(q * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, idx)];
}

describe('activation performance budget (v1.0 deliverable R)', () => {
  it(
    `activate() stays under p50 ${BUDGETS.p50Ms}ms / p95 ${BUDGETS.p95Ms}ms across ${BUDGETS.iterations} runs`,
    { timeout: 60_000 },
    async () => {
    const { activate, deactivate } = await import('../src/extension.js');

    // Warm-up: first run pays module-load cost; we exclude it from the sample.
    const warmCtx = createMockExtensionContext();
    activate(warmCtx as unknown as never);
    deactivate();

    const samples: number[] = [];
    for (let i = 0; i < BUDGETS.iterations; i++) {
      const ctx = createMockExtensionContext();
      const start = performance.now();
      activate(ctx as unknown as never);
      const elapsed = performance.now() - start;
      samples.push(elapsed);
      deactivate();
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const max = sorted[sorted.length - 1];
    const min = sorted[0];

    // Surface the distribution in the test log so regressions are easy
    // to triage without re-running locally.
    // eslint-disable-next-line no-console
    console.info(
      `[perf] activate() — n=${samples.length} min=${min.toFixed(2)}ms ` +
        `p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`,
    );

    expect(p50, `activate p50 ${p50.toFixed(2)}ms exceeds budget ${BUDGETS.p50Ms}ms`).toBeLessThan(
      BUDGETS.p50Ms,
    );
    expect(p95, `activate p95 ${p95.toFixed(2)}ms exceeds budget ${BUDGETS.p95Ms}ms`).toBeLessThan(
      BUDGETS.p95Ms,
    );
  });

  it('activate() does NOT eagerly start ActiveRunsTracker (lazy on view visibility / focus)', async () => {
    const trackerModule = await import('../src/services/activeRunsTracker.js');
    const startSpy = vi.spyOn(trackerModule.ActiveRunsTracker.prototype, 'start');

    const { activate, deactivate } = await import('../src/extension.js');
    const ctx = createMockExtensionContext();
    activate(ctx as unknown as never);

    // Lazy: start() is wired to sidebar visibility and the status-bar
    // focus command, NOT to activate() itself. Activation must stay cheap.
    expect(startSpy).not.toHaveBeenCalled();

    await Promise.resolve(deactivate());
    startSpy.mockRestore();
  });
});
