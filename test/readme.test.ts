/** Keeps the README honest: every number it shows is checked here. */
import { describe, expect, it } from "vitest";
import {
  type AccountSnapshot,
  consistencyPercent,
  dailyLossFloor,
  dailyLossLimit,
  evaluateChallenge,
  instrumentCurrencies,
  maxLossFloor,
  newYorkCloseOffset,
  parseRules,
  profitTargetAmount,
  profitTargetBalance,
  type Rule,
  requiredProfitForConsistency,
  tradingDayKey,
  trailingDrawdownFloor,
} from "../src/index.js";

const rules: Rule[] = [
  { code: "PROFIT_TARGET", params: { targetPercent: 8 } },
  { code: "MAX_DAILY_LOSS", params: { maxPercent: 5 } },
  { code: "MAX_OVERALL_LOSS", params: { maxPercent: 10 } },
  { code: "MIN_TRADING_DAYS", params: { minDays: 4 } },
];

const snapshots: AccountSnapshot[] = [
  { time: "2026-03-02T09:30:00Z", balance: 100_000, equity: 99_120 },
  { time: "2026-03-02T15:45:00Z", balance: 102_340, equity: 102_340 },
  { time: "2026-03-03T10:10:00Z", balance: 102_340, equity: 98_870 },
  { time: "2026-03-03T16:20:00Z", balance: 101_610, equity: 101_610 },
  { time: "2026-03-04T14:05:00Z", balance: 105_480, equity: 105_480 },
];

const evaluate = (history: AccountSnapshot[]) =>
  evaluateChallenge({ startingBalance: 100_000, rules, snapshots: history, dayResetUtcOffsetMinutes: 120 });

describe("README", () => {
  it("quick example", () => {
    const result = evaluate(snapshots);

    expect(result.status).toBe("in_progress");
    expect(result.endedAt).toBeNull();
    expect(result.breaches).toEqual([]);
    expect(result.progress).toEqual([
      {
        code: "PROFIT_TARGET",
        targetPercent: 8,
        targetBalance: 108_000,
        targetProfit: 8_000,
        profit: 5_480,
        remaining: 2_520,
        met: false,
      },
      {
        code: "MAX_DAILY_LOSS",
        maxPercent: 5,
        basis: "starting_balance",
        day: "2026-03-04",
        dayStartBalance: 101_610,
        dayStartEquity: 101_610,
        dayStartLevel: 101_610,
        allowedLoss: 5_000,
        floor: 96_610,
        lossToday: 0,
        distanceToFloor: 8_870,
      },
      { code: "MAX_OVERALL_LOSS", maxPercent: 10, allowedLoss: 10_000, floor: 90_000, distanceToFloor: 15_480 },
      { code: "MIN_TRADING_DAYS", minDays: 4, daysTraded: 3, remaining: 1, met: false },
    ]);
    expect(result.metrics).toMatchObject({
      balance: 105_480,
      equity: 105_480,
      profit: 5_480,
      profitPercent: 5.48,
      highWaterMark: 105_480,
      lowestEquity: 98_870,
      maxDrawdown: 3_470,
      maxDrawdownPercent: 3.47,
      tradingDays: 3,
    });
    expect(result.metrics.days[0]).toEqual({
      day: "2026-03-02",
      startBalance: 100_000,
      startEquity: 100_000,
      endBalance: 102_340,
      endEquity: 102_340,
      lowestEquity: 99_120,
      highestEquity: 102_340,
      profit: 2_340,
      traded: true,
    });
  });

  it("quick example: passing on day four", () => {
    const result = evaluate([
      ...snapshots,
      { time: "2026-03-05T13:30:00Z", balance: 106_920, equity: 107_400 },
      { time: "2026-03-05T18:00:00Z", balance: 108_150, equity: 108_150 },
    ]);

    expect(result.status).toBe("passed");
    expect(result.endedAt).toBe("2026-03-05T18:00:00.000Z");
  });

  it("quick example: failing on an intraday dip on day four", () => {
    const result = evaluate([
      ...snapshots,
      { time: "2026-03-05T13:30:00Z", balance: 105_480, equity: 100_310 },
      { time: "2026-03-05T18:00:00Z", balance: 106_900, equity: 106_900 },
    ]);

    expect(result.status).toBe("failed");
    expect(result.breaches).toEqual([
      {
        code: "MAX_DAILY_LOSS",
        time: "2026-03-05T13:30:00.000Z",
        day: "2026-03-05",
        limit: 100_480,
        value: 100_310,
        message: "Equity 100,310 fell below the daily loss floor of 100,480 (5% of the starting balance)",
      },
    ]);
  });

  it("helpers section", () => {
    const day = { startingBalance: 100_000, dayStartBalance: 102_000, dayStartEquity: 104_000, maxPercent: 5 };

    expect(profitTargetAmount(100_000, 8)).toBe(8_000);
    expect(profitTargetBalance(100_000, 8)).toBe(108_000);
    expect(maxLossFloor(100_000, 10)).toBe(90_000);
    expect(dailyLossLimit({ ...day, basis: "day_start_equity_or_balance_higher" })).toEqual({
      dayStartLevel: 104_000,
      allowedLoss: 5_200,
      floor: 98_800,
    });
    expect(dailyLossFloor(day)).toBe(97_000);
    expect(trailingDrawdownFloor({ highWaterMark: 108_000, startingBalance: 100_000, maxPercent: 6 })).toBe(102_000);
    expect(
      trailingDrawdownFloor({ highWaterMark: 108_000, startingBalance: 100_000, maxPercent: 6, lockAtStart: true }),
    ).toBe(100_000);
    expect(consistencyPercent([3_000, -500, 1_500])).toBe(75);
    expect(requiredProfitForConsistency(3_000, 40)).toBe(7_500);
    expect(tradingDayKey("2026-03-02T22:30:00Z", 120)).toBe("2026-03-03");
    expect(newYorkCloseOffset("2026-07-01T12:00:00Z")).toBe(180);
  });

  it("news rule section", () => {
    // What fetchIRDNewsWindows gives for the Fed's decision of 28 October 2026.
    const newsEvents = [{ bank: "fed", currency: "USD", t: "2026-10-28T18:00:00.000Z", name: "Federal Reserve" }];
    const result = evaluateChallenge({
      startingBalance: 100_000,
      rules: [
        { code: "MAX_DAILY_LOSS", params: { maxPercent: 5 } },
        { code: "NEWS_TRADING", params: { minutesBefore: 2, minutesAfter: 2 } },
      ],
      snapshots: [
        { time: "2026-10-28T17:30:00Z", balance: 100_420, equity: 100_420 },
        { time: "2026-10-28T18:20:00Z", balance: 101_030, equity: 101_030 },
      ],
      trades: [
        { openTime: "2026-10-28T14:00:00Z", closeTime: "2026-10-28T17:30:00Z", profit: 420, symbol: "EURUSD" },
        { openTime: "2026-10-28T18:01:00Z", closeTime: "2026-10-28T18:20:00Z", profit: 610, symbol: "XAUUSD" },
      ],
      newsEvents,
    });

    expect(result.status).toBe("failed");
    expect(result.breaches).toEqual([
      {
        code: "NEWS_TRADING",
        time: "2026-10-28T18:01:00.000Z",
        day: "2026-10-28",
        limit: 2,
        value: 1,
        message:
          "XAUUSD trade opened 1 minute after the Federal Reserve announcement (USD) at 2026-10-28T18:00:00.000Z; " +
          "trades must keep 2 minutes after it",
        trade: 1,
        news: {
          bank: "fed",
          name: "Federal Reserve",
          currency: "USD",
          time: "2026-10-28T18:00:00.000Z",
          start: "2026-10-28T17:58:00.000Z",
          end: "2026-10-28T18:02:00.000Z",
        },
      },
    ]);

    for (const symbol of ["EURUSD", "EUR/USD", "eurusd.raw", "EURUSDm"]) {
      expect(instrumentCurrencies(symbol)).toEqual(["EUR", "USD"]);
    }
    for (const symbol of ["XAUUSD", "XAGUSD", "BTCUSD", "US30", "NAS100", "US500", "USOIL"]) {
      expect(instrumentCurrencies(symbol)).toEqual(["USD"]);
    }
    expect(["GER40", "UK100", "JP225", "AUS200"].map((symbol) => instrumentCurrencies(symbol))).toEqual([
      ["EUR"],
      ["GBP"],
      ["JPY"],
      ["AUD"],
    ]);
  });

  it("landing page templates section", () => {
    // The shape a prop-firm-landing-page-templates phase has in site/config.ts.
    const phase = {
      phase: "PHASE_1",
      startingBalance: 10_000,
      currency: "USD",
      leverage: 100,
      profitSplit: null,
      maxDurationDays: null,
      rules: [
        { code: "PROFIT_TARGET", params: { targetPercent: 8 } },
        { code: "MAX_DAILY_LOSS", params: { maxPercent: 5 } },
        { code: "MAX_OVERALL_LOSS", params: { maxPercent: 10 } },
        { code: "MIN_TRADING_DAYS", params: { minDays: 4 } },
      ],
    };

    const result = evaluateChallenge({
      startingBalance: phase.startingBalance,
      rules: parseRules(phase.rules, { ignoreUnknown: true }),
      snapshots: [{ time: "2026-03-02T15:00:00Z", balance: 10_400, equity: 10_400 }],
    });

    expect(result.status).toBe("in_progress");
    expect(result.progress[0]).toMatchObject({ targetBalance: 10_800, remaining: 400 });
    // Still day one, which started flat at 10,000: floor 10,000 - 5% of 10,000.
    expect(result.progress[1]).toMatchObject({ floor: 9_500, distanceToFloor: 900 });
  });
});
