import { describe, expect, it } from "vitest";
import { evaluateChallenge } from "../src/index.js";
import { dailyLoss, maxLoss, START, snap, target } from "./fixtures.js";

describe("PROFIT_TARGET", () => {
  it("passes when the closed balance reaches the target", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8)],
      snapshots: [
        snap("2026-03-02T10:00:00Z", 100_000, 101_000),
        snap("2026-03-02T15:00:00Z", 104_000),
        snap("2026-03-03T15:00:00Z", 108_000),
        snap("2026-03-04T15:00:00Z", 107_000),
      ],
    });

    expect(result.status).toBe("passed");
    expect(result.endedAt).toBe("2026-03-03T15:00:00.000Z");
    expect(result.breaches).toEqual([]);
    expect(result.progress[0]).toEqual({
      code: "PROFIT_TARGET",
      targetPercent: 8,
      targetBalance: 108_000,
      targetProfit: 8_000,
      profit: 8_000,
      remaining: 0,
      met: true,
    });
    // The challenge ended at the pass: the later snapshot is not evaluated.
    expect(result.metrics.balance).toBe(108_000);
  });

  it("does not count floating profit toward the target", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8)],
      snapshots: [snap("2026-03-02T10:00:00Z", 100_000, 109_500)],
    });

    expect(result.status).toBe("in_progress");
    expect(result.progress[0]).toMatchObject({ profit: 0, remaining: 8_000, met: false });
  });

  it("passes exactly at the target, not a cent before", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8)],
      snapshots: [snap("2026-03-02T10:00:00Z", 107_999.99), snap("2026-03-02T11:00:00Z", 108_000)],
    });

    expect(result.status).toBe("passed");
    expect(result.endedAt).toBe("2026-03-02T11:00:00.000Z");
  });

  it("never passes without a PROFIT_TARGET rule (a funded account), only fails", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [dailyLoss(5), maxLoss(10)],
      snapshots: [snap("2026-03-02T10:00:00Z", 120_000)],
    });

    expect(result.status).toBe("in_progress");
    expect(result.endedAt).toBeNull();
  });
});
