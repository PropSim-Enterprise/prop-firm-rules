/**
 * Small pure helpers for calculators and UIs. evaluateChallenge uses the same
 * functions, so a number shown in a UI matches the engine.
 */
import { InvalidInputError } from "./errors.js";
import { percentOf, tidy } from "./math.js";
import type { DailyLossBasis } from "./types.js";
import { describe, finiteNumber, percentNumber, positiveNumber } from "./validate.js";

/** The profit a PROFIT_TARGET needs: 100,000 at 8% needs 8,000. */
export function profitTargetAmount(startingBalance: number, targetPercent: number): number {
  const start = positiveNumber(startingBalance, "startingBalance");
  return tidy(percentOf(start, positiveNumber(targetPercent, "targetPercent")));
}

/** The closed balance that passes a PROFIT_TARGET: 100,000 at 8% is 108,000. */
export function profitTargetBalance(startingBalance: number, targetPercent: number): number {
  return tidy(startingBalance + profitTargetAmount(startingBalance, targetPercent));
}

/** The static MAX_OVERALL_LOSS floor: 100,000 at 10% is 90,000. */
export function maxLossFloor(startingBalance: number, maxPercent: number): number {
  const start = positiveNumber(startingBalance, "startingBalance");
  return tidy(start - percentOf(start, percentNumber(maxPercent, "maxPercent")));
}

export interface DailyLossInput {
  startingBalance: number;
  /** Balance when the trading day started. */
  dayStartBalance: number;
  /** Equity when the trading day started. */
  dayStartEquity: number;
  maxPercent: number;
  /** Defaults to "starting_balance". */
  basis?: DailyLossBasis;
}

export interface DailyLossLimit {
  /** The level today's loss is measured from. */
  dayStartLevel: number;
  /** How much may be lost today. */
  allowedLoss: number;
  /** Equity must stay at or above this today: dayStartLevel minus allowedLoss. */
  floor: number;
}

const DAILY_LOSS_BASES: readonly DailyLossBasis[] = [
  "starting_balance",
  "day_start_balance",
  "day_start_equity_or_balance_higher",
];

function checkedBasis(basis: unknown): DailyLossBasis {
  if (DAILY_LOSS_BASES.includes(basis as DailyLossBasis)) return basis as DailyLossBasis;
  throw new InvalidInputError(`basis must be one of ${DAILY_LOSS_BASES.join(", ")}, got ${describe(basis)}`);
}

/** The amount the percent is taken of, and the level the loss is measured from. */
function dailyLossLevels(input: DailyLossInput, basis: DailyLossBasis): { base: number; from: number } {
  const dayStartBalance = finiteNumber(input.dayStartBalance, "dayStartBalance");
  if (basis === "starting_balance") {
    return { base: positiveNumber(input.startingBalance, "startingBalance"), from: dayStartBalance };
  }
  if (basis === "day_start_balance") return { base: dayStartBalance, from: dayStartBalance };
  const higher = Math.max(dayStartBalance, finiteNumber(input.dayStartEquity, "dayStartEquity"));
  return { base: higher, from: higher };
}

/**
 * Today's MAX_DAILY_LOSS limit.
 *
 * - "starting_balance": allowed loss = maxPercent of the starting balance, measured from the day-start balance.
 * - "day_start_balance": allowed loss = maxPercent of the day-start balance, measured from it.
 * - "day_start_equity_or_balance_higher": allowed loss = maxPercent of the higher of day-start
 *   balance and equity, measured from that higher level.
 */
export function dailyLossLimit(input: DailyLossInput): DailyLossLimit {
  const basis = checkedBasis(input.basis ?? "starting_balance");
  const { base, from } = dailyLossLevels(input, basis);
  const allowedLoss = percentOf(base, percentNumber(input.maxPercent, "maxPercent"));
  return { dayStartLevel: tidy(from), allowedLoss: tidy(allowedLoss), floor: tidy(from - allowedLoss) };
}

/** Today's MAX_DAILY_LOSS equity floor. See dailyLossLimit for the bases. */
export function dailyLossFloor(input: DailyLossInput): number {
  return dailyLossLimit(input).floor;
}

export interface TrailingDrawdownInput {
  /** The peak the floor trails (equity or balance, as the firm defines it). */
  highWaterMark: number;
  startingBalance: number;
  maxPercent: number;
  /** Stop the floor at the starting balance once it gets there. Defaults to false. */
  lockAtStart?: boolean;
}

/**
 * The TRAILING_DRAWDOWN floor: high-water mark minus maxPercent of the starting
 * balance, capped at the starting balance when lockAtStart is set.
 * 100,000 account, 6%, peak 103,000: floor 97,000. Peak 107,000 with lockAtStart: floor 100,000.
 */
export function trailingDrawdownFloor(input: TrailingDrawdownInput): number {
  const start = positiveNumber(input.startingBalance, "startingBalance");
  const drawdown = percentOf(start, percentNumber(input.maxPercent, "maxPercent"));
  const floor = finiteNumber(input.highWaterMark, "highWaterMark") - drawdown;
  return tidy(input.lockAtStart === true ? Math.min(floor, start) : floor);
}

/**
 * The best day's profit as a percent of the total profit, or null when the
 * total is 0 or less. [3000, -500, 1500] is 3000 / 4000 = 75.
 */
export function consistencyPercent(dailyProfits: readonly number[]): number | null {
  const profits = dailyProfits.map((profit, i) => finiteNumber(profit, `dailyProfits[${i}]`));
  const total = profits.reduce((sum, profit) => sum + profit, 0);
  if (total <= 0) return null;
  return tidy((Math.max(...profits) / total) * 100);
}

/**
 * The total profit at which bestDayProfit is exactly maxDayPercent of it:
 * a 3,000 best day under a 40% rule needs 7,500 total profit.
 */
export function requiredProfitForConsistency(bestDayProfit: number, maxDayPercent: number): number {
  const best = Math.max(0, finiteNumber(bestDayProfit, "bestDayProfit"));
  return tidy((best * 100) / percentNumber(maxDayPercent, "maxDayPercent"));
}
