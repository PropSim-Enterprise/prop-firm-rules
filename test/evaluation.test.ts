import { describe, expect, it } from "vitest";
import { evaluateChallenge } from "../src/index.js";
import { dailyLoss, maxLoss, minDays, START, snap, target, trade } from "./fixtures.js";

describe("evaluateChallenge", () => {
  describe("when rules break", () => {
    it("fails on the first breach and ignores the history after it", () => {
      const result = evaluateChallenge({
        startingBalance: START,
        rules: [maxLoss(10), dailyLoss(5)],
        snapshots: [
          snap("2026-03-02T10:00:00Z", 100_000, 94_000), // daily floor 95,000 broken
          snap("2026-03-02T11:00:00Z", 100_000, 89_000), // would break the overall floor too
        ],
      });

      expect(result.status).toBe("failed");
      expect(result.endedAt).toBe("2026-03-02T10:00:00.000Z");
      expect(result.breaches.map((b) => b.code)).toEqual(["MAX_DAILY_LOSS"]);
      expect(result.metrics.equity).toBe(94_000);
      expect(result.metrics.lowestEquity).toBe(94_000);
    });

    it("reports every rule broken at the same moment, in rule order", () => {
      const snapshots = [snap("2026-03-02T10:00:00Z", 100_000, 89_000)];

      const overallFirst = evaluateChallenge({ startingBalance: START, rules: [maxLoss(10), dailyLoss(5)], snapshots });
      expect(overallFirst.breaches.map((b) => [b.code, b.limit])).toEqual([
        ["MAX_OVERALL_LOSS", 90_000],
        ["MAX_DAILY_LOSS", 95_000],
      ]);

      const dailyFirst = evaluateChallenge({ startingBalance: START, rules: [dailyLoss(5), maxLoss(10)], snapshots });
      expect(dailyFirst.breaches.map((b) => b.code)).toEqual(["MAX_DAILY_LOSS", "MAX_OVERALL_LOSS"]);
    });

    it("fails rather than passes when the target and a breach happen at the same moment", () => {
      // A closed winner reaches the target while an open loser breaks the daily floor.
      const result = evaluateChallenge({
        startingBalance: START,
        rules: [target(8), dailyLoss(5)],
        snapshots: [snap("2026-03-02T10:00:00Z", 108_000, 94_000)],
      });

      expect(result.status).toBe("failed");
      expect(result.breaches[0]?.code).toBe("MAX_DAILY_LOSS");
    });

    it("checks a trade together with the snapshot taken at the same instant", () => {
      // The trade completes the minimum days, but the snapshot at that instant breaks the daily floor.
      const result = evaluateChallenge({
        startingBalance: START,
        rules: [target(8), minDays(2), dailyLoss(5)],
        trades: [
          trade("2026-03-02T09:00:00Z", "2026-03-02T12:00:00Z", 8_000),
          trade("2026-03-03T09:00:00Z", null),
        ],
        snapshots: [snap("2026-03-02T12:00:00Z", 108_000), snap("2026-03-03T09:00:00Z", 108_000, 102_500)],
      });

      expect(result.status).toBe("failed");
      expect(result.breaches[0]).toMatchObject({ code: "MAX_DAILY_LOSS", limit: 103_000, value: 102_500 });
    });
  });

  describe("metrics", () => {
    it("tracks the high-water mark, lowest equity and max drawdown", () => {
      const result = evaluateChallenge({
        startingBalance: START,
        rules: [maxLoss(10)],
        snapshots: [
          snap("2026-03-02T10:00:00Z", 100_000, 104_000),
          snap("2026-03-02T12:00:00Z", 101_000), // 3,000 off the peak
          snap("2026-03-03T10:00:00Z", 101_000, 106_000),
          snap("2026-03-03T12:00:00Z", 102_500), // 3,500 off the new peak
        ],
      });

      expect(result.metrics).toMatchObject({
        balance: 102_500,
        equity: 102_500,
        profit: 2_500,
        profitPercent: 2.5,
        highWaterMark: 106_000,
        lowestEquity: 100_000,
        maxDrawdown: 3_500,
        maxDrawdownPercent: 3.5,
        tradingDays: 2,
      });
    });

    it("summarises each trading day", () => {
      const result = evaluateChallenge({
        startingBalance: START,
        rules: [],
        snapshots: [
          snap("2026-03-02T10:00:00Z", 100_000, 98_500),
          snap("2026-03-02T20:00:00Z", 101_200, 101_700),
          snap("2026-03-03T10:00:00Z", 101_200, 102_400),
        ],
      });

      expect(result.metrics.days).toEqual([
        {
          day: "2026-03-02",
          startBalance: 100_000,
          startEquity: 100_000,
          endBalance: 101_200,
          endEquity: 101_700,
          lowestEquity: 98_500,
          highestEquity: 101_700,
          profit: 1_200,
          traded: true,
        },
        {
          day: "2026-03-03",
          startBalance: 101_200,
          startEquity: 101_700,
          endBalance: 101_200,
          endEquity: 102_400,
          lowestEquity: 101_700,
          highestEquity: 102_400,
          profit: 0,
          traded: false,
        },
      ]);
    });

    it("rounds floating point noise out of the result", () => {
      const result = evaluateChallenge({
        startingBalance: 0.3,
        rules: [target(10)],
        snapshots: [snap("2026-03-02T10:00:00Z", 0.1 + 0.2)],
      });

      expect(result.metrics.profit).toBe(0);
      expect(result.progress[0]).toMatchObject({ targetBalance: 0.33, remaining: 0.03 });
    });
  });

  it("returns a flat, in-progress account when there is no history yet", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8), dailyLoss(5), maxLoss(10)],
      snapshots: [],
    });

    expect(result.status).toBe("in_progress");
    expect(result.endedAt).toBeNull();
    expect(result.progress[1]).toMatchObject({ day: null, dayStartBalance: 100_000, floor: 95_000 });
    expect(result.metrics).toMatchObject({ balance: 100_000, equity: 100_000, tradingDays: 0, days: [] });
  });

  it("accepts Date objects and epoch milliseconds as times", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8)],
      snapshots: [
        { time: new Date("2026-03-02T10:00:00Z"), balance: 104_000, equity: 104_000 },
        { time: Date.parse("2026-03-03T10:00:00Z"), balance: 108_000, equity: 108_000 },
      ],
    });

    expect(result.endedAt).toBe("2026-03-03T10:00:00.000Z");
  });
});
