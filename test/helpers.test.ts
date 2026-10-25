import { describe, expect, it } from "vitest";
import {
  consistencyPercent,
  dailyLossFloor,
  dailyLossLimit,
  InvalidInputError,
  maxLossFloor,
  profitTargetAmount,
  profitTargetBalance,
  requiredProfitForConsistency,
  trailingDrawdownFloor,
} from "../src/index.js";

describe("helpers", () => {
  it("profitTargetAmount and profitTargetBalance", () => {
    expect(profitTargetAmount(100_000, 8)).toBe(8_000);
    expect(profitTargetBalance(100_000, 8)).toBe(108_000);
    expect(profitTargetBalance(25_000, 10)).toBe(27_500);
  });

  it("maxLossFloor", () => {
    expect(maxLossFloor(100_000, 10)).toBe(90_000);
    expect(maxLossFloor(50_000, 6)).toBe(47_000);
  });

  it("dailyLossLimit for each basis", () => {
    const day = { startingBalance: 100_000, dayStartBalance: 102_000, dayStartEquity: 104_000, maxPercent: 5 };

    expect(dailyLossLimit(day)).toEqual({ dayStartLevel: 102_000, allowedLoss: 5_000, floor: 97_000 });
    expect(dailyLossLimit({ ...day, basis: "day_start_balance" })).toEqual({
      dayStartLevel: 102_000,
      allowedLoss: 5_100,
      floor: 96_900,
    });
    expect(dailyLossLimit({ ...day, basis: "day_start_equity_or_balance_higher" })).toEqual({
      dayStartLevel: 104_000,
      allowedLoss: 5_200,
      floor: 98_800,
    });
    expect(dailyLossFloor({ ...day, basis: "starting_balance" })).toBe(97_000);
  });

  it("trailingDrawdownFloor with and without lockAtStart", () => {
    const base = { startingBalance: 100_000, maxPercent: 6 };

    expect(trailingDrawdownFloor({ ...base, highWaterMark: 100_000 })).toBe(94_000);
    expect(trailingDrawdownFloor({ ...base, highWaterMark: 103_000 })).toBe(97_000);
    expect(trailingDrawdownFloor({ ...base, highWaterMark: 108_000 })).toBe(102_000);
    expect(trailingDrawdownFloor({ ...base, highWaterMark: 108_000, lockAtStart: true })).toBe(100_000);
    expect(trailingDrawdownFloor({ ...base, highWaterMark: 103_000, lockAtStart: true })).toBe(97_000);
  });

  it("consistencyPercent and requiredProfitForConsistency", () => {
    expect(consistencyPercent([3_000, -500, 1_500])).toBe(75);
    expect(consistencyPercent([2_000, 2_000])).toBe(50);
    expect(consistencyPercent([])).toBeNull();
    expect(consistencyPercent([-100, 50])).toBeNull();
    expect(requiredProfitForConsistency(3_000, 40)).toBe(7_500);
    expect(requiredProfitForConsistency(-200, 40)).toBe(0);
  });

  it("removes floating point noise from results", () => {
    expect(dailyLossFloor({ startingBalance: 100_000, dayStartBalance: 102_345.67, dayStartEquity: 0, maxPercent: 5 }))
      .toBe(97_345.67);
    expect(maxLossFloor(0.3, 10)).toBe(0.27);
  });

  it("rejects invalid arguments", () => {
    expect(() => profitTargetAmount(0, 8)).toThrow(InvalidInputError);
    expect(() => maxLossFloor(100_000, 150)).toThrow("maxPercent must be a percent from 0 to 100, got 150");
    expect(() => dailyLossFloor({ startingBalance: 100_000, dayStartBalance: 100_000, dayStartEquity: 100_000, maxPercent: 5, basis: "equity" as never })).toThrow(
      "basis must be one of",
    );
    expect(() => consistencyPercent([1, Number.NaN])).toThrow("dailyProfits[1] must be a finite number");
  });
});
