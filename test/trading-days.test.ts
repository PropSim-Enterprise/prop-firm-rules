import { describe, expect, it } from "vitest";
import { evaluateChallenge } from "../src/index.js";
import { maxDays, minDays, START, snap, target, trade } from "./fixtures.js";

describe("MIN_TRADING_DAYS", () => {
  it("passes only once both the target and the minimum days are met", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8), minDays(4)],
      trades: [
        trade("2026-03-02T09:00:00Z", "2026-03-02T15:00:00Z", 5_000),
        trade("2026-03-03T09:00:00Z", "2026-03-03T15:00:00Z", 3_500),
        trade("2026-03-04T09:00:00Z", "2026-03-04T10:00:00Z", 100),
        trade("2026-03-05T09:00:00Z", "2026-03-05T10:00:00Z", 50),
      ],
      snapshots: [
        snap("2026-03-02T15:00:00Z", 105_000),
        snap("2026-03-03T15:00:00Z", 108_500), // target met, but only 2 trading days
        snap("2026-03-04T10:00:00Z", 108_600),
        snap("2026-03-05T10:00:00Z", 108_650),
      ],
    });

    expect(result.status).toBe("passed");
    // The fourth trading day starts when its first trade opens.
    expect(result.endedAt).toBe("2026-03-05T09:00:00.000Z");
    expect(result.progress[1]).toEqual({
      code: "MIN_TRADING_DAYS",
      minDays: 4,
      daysTraded: 4,
      remaining: 0,
      met: true,
    });
  });

  it("stays in progress when the days are met but the target is not", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8), minDays(2)],
      snapshots: [snap("2026-03-02T15:00:00Z", 101_000), snap("2026-03-03T15:00:00Z", 102_000)],
    });

    expect(result.status).toBe("in_progress");
    expect(result.progress[1]).toMatchObject({ daysTraded: 2, met: true });
  });

  it("counts trading days by the reset-adjusted day", () => {
    // 21:30 and 22:30 UTC are the same UTC day but either side of midnight at UTC+2.
    const trades = [trade("2026-03-02T21:30:00Z", null), trade("2026-03-02T22:30:00Z", null)];
    const run = (offset: number) =>
      evaluateChallenge({
        startingBalance: START,
        rules: [minDays(3)],
        snapshots: [],
        trades,
        dayResetUtcOffsetMinutes: offset,
      });

    expect(run(120).metrics.tradingDays).toBe(2);
    expect(run(120).metrics.days.map((d) => d.day)).toEqual(["2026-03-02", "2026-03-03"]);
    expect(run(0).metrics.tradingDays).toBe(1);
  });

  it("counts the day a trade was opened, not the days it was held or closed", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [minDays(2)],
      trades: [trade("2026-03-02T10:00:00Z", "2026-03-04T10:00:00Z", 900)],
      snapshots: [snap("2026-03-03T10:00:00Z", 100_000, 100_400), snap("2026-03-04T10:00:00Z", 100_900)],
    });

    expect(result.metrics.tradingDays).toBe(1);
    expect(result.metrics.days.map((d) => [d.day, d.traded, d.profit])).toEqual([
      ["2026-03-02", true, 0],
      ["2026-03-03", false, 0],
      ["2026-03-04", false, 900],
    ]);
  });

  it("reads trading days and daily profit from balance changes when no trades are given", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [minDays(5)],
      snapshots: [
        snap("2026-03-02T10:00:00Z", 100_000, 100_500), // floating only
        snap("2026-03-02T16:00:00Z", 100_400),
        snap("2026-03-03T10:00:00Z", 100_400, 100_100), // floating only: not a trading day
        snap("2026-03-04T10:00:00Z", 100_200),
      ],
    });

    expect(result.metrics.tradingDays).toBe(2);
    expect(result.metrics.days.map((d) => [d.day, d.traded, d.profit])).toEqual([
      ["2026-03-02", true, 400],
      ["2026-03-03", false, 0],
      ["2026-03-04", true, -200],
    ]);
    expect(result.progress[0]).toMatchObject({ daysTraded: 2, remaining: 3, met: false });
  });
});

describe("MAX_TRADING_DAYS", () => {
  const dailyTrade = (day: string) => trade(`${day}T09:00:00Z`, `${day}T10:00:00Z`, 100);

  it("fails when the account trades on one day more than allowed without passing", () => {
    const days = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"];
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(10), maxDays(3)],
      trades: days.map(dailyTrade),
      snapshots: days.map((day, i) => snap(`${day}T10:00:00Z`, START + 100 * (i + 1))),
    });

    expect(result.status).toBe("failed");
    expect(result.breaches).toEqual([
      {
        code: "MAX_TRADING_DAYS",
        time: "2026-03-05T09:00:00.000Z",
        day: "2026-03-05",
        limit: 3,
        value: 4,
        message: "Traded on 4 days without passing; the limit is 3 trading days",
      },
    ]);
  });

  it("passes when the target is reached on the last allowed day", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8), maxDays(3)],
      snapshots: [
        snap("2026-03-02T15:00:00Z", 103_000),
        snap("2026-03-03T15:00:00Z", 105_000),
        snap("2026-03-04T15:00:00Z", 108_200),
        snap("2026-03-05T15:00:00Z", 108_500),
      ],
    });

    expect(result.status).toBe("passed");
    expect(result.endedAt).toBe("2026-03-04T15:00:00.000Z");
    expect(result.progress[1]).toEqual({ code: "MAX_TRADING_DAYS", maxDays: 3, daysTraded: 3, remaining: 0 });
  });

  it("stays in progress on the last allowed day", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8), maxDays(2)],
      snapshots: [snap("2026-03-02T15:00:00Z", 101_000), snap("2026-03-03T15:00:00Z", 102_000)],
    });

    expect(result.status).toBe("in_progress");
    expect(result.progress[1]).toMatchObject({ daysTraded: 2, remaining: 0 });
  });
});
