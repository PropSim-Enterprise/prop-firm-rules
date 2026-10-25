import { describe, expect, it } from "vitest";
import { type AccountSnapshot, evaluateChallenge, newYorkCloseOffset } from "../src/index.js";
import { dailyLoss, START, snap } from "./fixtures.js";

/** Day one closes with a 2,000 closed profit and a 2,000 floating profit carried overnight. */
const DAY_ONE: AccountSnapshot[] = [
  snap("2026-03-02T10:00:00Z", 100_000),
  snap("2026-03-02T20:00:00Z", 102_000, 104_000),
];

describe("MAX_DAILY_LOSS", () => {
  it("measures the loss from the day-start balance, sized off the starting balance by default", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [dailyLoss(5)],
      snapshots: [snap("2026-03-02T10:00:00Z", 100_000), snap("2026-03-02T20:00:00Z", 102_000), snap("2026-03-03T10:00:00Z", 102_000, 97_100)],
    });

    expect(result.status).toBe("in_progress");
    expect(result.progress[0]).toEqual({
      code: "MAX_DAILY_LOSS",
      maxPercent: 5,
      basis: "starting_balance",
      day: "2026-03-03",
      dayStartBalance: 102_000,
      dayStartEquity: 102_000,
      dayStartLevel: 102_000,
      allowedLoss: 5_000,
      floor: 97_000,
      lossToday: 4_900,
      distanceToFloor: 100,
    });
  });

  it("fails when equity drops below the day's floor and reports the breach", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [dailyLoss(5)],
      snapshots: [
        snap("2026-03-02T20:00:00Z", 102_000),
        snap("2026-03-03T10:00:00Z", 102_000, 97_100),
        snap("2026-03-03T11:00:00Z", 102_000, 96_900),
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.endedAt).toBe("2026-03-03T11:00:00.000Z");
    expect(result.breaches).toEqual([
      {
        code: "MAX_DAILY_LOSS",
        time: "2026-03-03T11:00:00.000Z",
        day: "2026-03-03",
        limit: 97_000,
        value: 96_900,
        message: "Equity 96,900 fell below the daily loss floor of 97,000 (5% of the starting balance)",
      },
    ]);
  });

  it("allows equity exactly at the floor", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [dailyLoss(5)],
      snapshots: [snap("2026-03-02T10:00:00Z", 100_000, 95_000)],
    });

    expect(result.status).toBe("in_progress");
    expect(result.progress[0]).toMatchObject({ floor: 95_000, distanceToFloor: 0 });
  });

  it("fails on an intraday equity breach even if the day closes in profit", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [dailyLoss(5)],
      snapshots: [
        snap("2026-03-02T09:00:00Z", 100_000),
        snap("2026-03-02T10:00:00Z", 100_000, 94_500),
        snap("2026-03-02T21:00:00Z", 100_500),
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.breaches[0]).toMatchObject({ code: "MAX_DAILY_LOSS", limit: 95_000, value: 94_500 });
    expect(result.endedAt).toBe("2026-03-02T10:00:00.000Z");
  });

  it("gives different results for each basis on the same data", () => {
    const snapshots = [...DAY_ONE, snap("2026-03-03T09:00:00Z", 102_000, 96_950)];
    const run = (basis: "starting_balance" | "day_start_balance" | "day_start_equity_or_balance_higher") =>
      evaluateChallenge({ startingBalance: START, rules: [dailyLoss(5, basis)], snapshots });

    // 102,000 - 5% of 100,000 = 97,000
    expect(run("starting_balance").breaches[0]).toMatchObject({ limit: 97_000, value: 96_950 });
    // 102,000 - 5% of 102,000 = 96,900
    expect(run("day_start_balance").status).toBe("in_progress");
    expect(run("day_start_balance").progress[0]).toMatchObject({ floor: 96_900 });
    // max(102,000, 104,000) = 104,000; 104,000 - 5% of it = 98,800
    expect(run("day_start_equity_or_balance_higher").breaches[0]).toMatchObject({ limit: 98_800 });
  });

  it("uses the day-start balance for the higher-of basis when equity started lower", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [dailyLoss(5, "day_start_equity_or_balance_higher")],
      snapshots: [snap("2026-03-02T20:00:00Z", 102_000, 101_000), snap("2026-03-03T09:00:00Z", 102_000, 99_000)],
    });

    expect(result.progress[0]).toMatchObject({
      dayStartBalance: 102_000,
      dayStartEquity: 101_000,
      dayStartLevel: 102_000,
      allowedLoss: 5_100,
      floor: 96_900,
      lossToday: 3_000,
    });
  });

  it("starts the day from the last snapshot before the reset, floating P&L included", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [dailyLoss(5, "day_start_equity_or_balance_higher")],
      snapshots: [...DAY_ONE, snap("2026-03-03T09:00:00Z", 102_000, 103_000)],
    });

    expect(result.progress[0]).toMatchObject({
      day: "2026-03-03",
      dayStartBalance: 102_000,
      dayStartEquity: 104_000,
      floor: 98_800,
      lossToday: 1_000,
    });
  });

  it("resets the day at 00:00 in the server's UTC offset", () => {
    // 3,000 lost before the server's midnight (22:00 UTC at UTC+2), 4,000 more after it.
    const snapshots = [snap("2026-03-02T21:00:00Z", 97_000), snap("2026-03-02T23:00:00Z", 97_000, 93_000)];

    const utcPlus2 = evaluateChallenge({
      startingBalance: START,
      rules: [dailyLoss(5)],
      snapshots,
      dayResetUtcOffsetMinutes: 120,
    });
    expect(utcPlus2.status).toBe("in_progress");
    expect(utcPlus2.progress[0]).toMatchObject({ day: "2026-03-03", dayStartBalance: 97_000, floor: 92_000 });

    const utc = evaluateChallenge({ startingBalance: START, rules: [dailyLoss(5)], snapshots });
    expect(utc.status).toBe("failed");
    expect(utc.breaches[0]).toMatchObject({ day: "2026-03-02", limit: 95_000, value: 93_000 });
  });

  it("follows the New York close across a daylight saving change", () => {
    // 2026-03-10 is in US daylight saving time, so the New York close is 21:00 UTC.
    const snapshots = [snap("2026-03-10T20:30:00Z", 96_000), snap("2026-03-10T21:30:00Z", 96_000, 92_000)];

    const nyClose = evaluateChallenge({
      startingBalance: START,
      rules: [dailyLoss(5)],
      snapshots,
      dayResetUtcOffsetMinutes: newYorkCloseOffset,
    });
    expect(nyClose.status).toBe("in_progress");
    expect(nyClose.progress[0]).toMatchObject({ day: "2026-03-11", floor: 91_000 });

    const fixedUtcPlus2 = evaluateChallenge({
      startingBalance: START,
      rules: [dailyLoss(5)],
      snapshots,
      dayResetUtcOffsetMinutes: 120,
    });
    expect(fixedUtcPlus2.status).toBe("failed");
  });
});
