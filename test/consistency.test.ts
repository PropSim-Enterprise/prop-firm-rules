import { describe, expect, it } from "vitest";
import { evaluateChallenge } from "../src/index.js";
import { consistency, START, snap, target, trade } from "./fixtures.js";

describe("CONSISTENCY", () => {
  const dayCloses = [
    snap("2026-03-02T20:00:00Z", 105_000), // +5,000: the best day
    snap("2026-03-03T20:00:00Z", 108_000), // +3,000: target reached
    snap("2026-03-04T20:00:00Z", 111_000), // +3,000
    snap("2026-03-05T20:00:00Z", 112_500), // +1,500
  ];

  it("holds the pass while the best day is too large a share of the profit", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8), consistency(40)],
      snapshots: dayCloses.slice(0, 2),
    });

    expect(result.status).toBe("in_progress");
    expect(result.progress[1]).toEqual({
      code: "CONSISTENCY",
      maxDayPercent: 40,
      bestDay: "2026-03-02",
      bestDayProfit: 5_000,
      totalProfit: 8_000,
      bestDayPercent: 62.5,
      requiredTotalProfit: 12_500,
      met: false,
    });
  });

  it("passes once more profit brings the best day within the limit", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8), consistency(40)],
      snapshots: dayCloses,
    });

    // Day three: 5,000 / 11,000 = 45.5%, still too much. Day four: 5,000 / 12,500 = 40%.
    expect(result.status).toBe("passed");
    expect(result.endedAt).toBe("2026-03-05T20:00:00.000Z");
    expect(result.progress[1]).toMatchObject({ bestDayPercent: 40, met: true });
  });

  it("attributes trade profit to the day the trade closed", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [consistency(50)],
      trades: [
        trade("2026-03-02T10:00:00Z", "2026-03-03T10:00:00Z", 3_000),
        trade("2026-03-03T11:00:00Z", "2026-03-03T12:00:00Z", 1_000),
        trade("2026-03-04T10:00:00Z", "2026-03-04T12:00:00Z", 3_500),
      ],
      snapshots: [
        snap("2026-03-03T10:00:00Z", 103_000),
        snap("2026-03-03T12:00:00Z", 104_000),
        snap("2026-03-04T12:00:00Z", 107_500),
      ],
    });

    expect(result.progress[0]).toMatchObject({
      bestDay: "2026-03-03",
      bestDayProfit: 4_000,
      totalProfit: 7_500,
      bestDayPercent: 53.33333333,
      met: false,
    });
    expect(result.metrics.tradingDays).toBe(3);
  });

  it("is not met while there is no net profit", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [consistency(40)],
      snapshots: [snap("2026-03-02T20:00:00Z", 101_000), snap("2026-03-03T20:00:00Z", 99_000)],
    });

    expect(result.progress[0]).toMatchObject({
      bestDay: "2026-03-02",
      totalProfit: -1_000,
      bestDayPercent: null,
      met: false,
    });
  });
});
