import type { AccountSnapshot, DailyLossBasis, NewsEvent, Rule, Trade, TrailingSource } from "../src/index.js";

export const START = 100_000;

/** A snapshot; equity defaults to balance (no open positions). */
export function snap(time: string, balance: number, equity: number = balance): AccountSnapshot {
  return { time, balance, equity };
}

export function trade(openTime: string, closeTime: string | null, profit?: number, symbol?: string): Trade {
  const base: Trade = profit === undefined ? { openTime, closeTime } : { openTime, closeTime, profit };
  return symbol === undefined ? base : { ...base, symbol };
}

export const target = (targetPercent: number): Rule => ({ code: "PROFIT_TARGET", params: { targetPercent } });

export const dailyLoss = (maxPercent: number, basis?: DailyLossBasis): Rule =>
  basis ? { code: "MAX_DAILY_LOSS", params: { maxPercent, basis } } : { code: "MAX_DAILY_LOSS", params: { maxPercent } };

export const maxLoss = (maxPercent: number): Rule => ({ code: "MAX_OVERALL_LOSS", params: { maxPercent } });

export const trailing = (maxPercent: number, trailOn: TrailingSource = "equity", lockAtStart = false): Rule => ({
  code: "TRAILING_DRAWDOWN",
  params: { maxPercent, trailOn, lockAtStart },
});

export const minDays = (days: number): Rule => ({ code: "MIN_TRADING_DAYS", params: { minDays: days } });

export const maxDays = (days: number): Rule => ({ code: "MAX_TRADING_DAYS", params: { maxDays: days } });

export const consistency = (maxDayPercent: number): Rule => ({ code: "CONSISTENCY", params: { maxDayPercent } });

export const newsRule = (minutesBefore: number, minutesAfter?: number): Rule =>
  minutesAfter === undefined
    ? { code: "NEWS_TRADING", params: { minutesBefore } }
    : { code: "NEWS_TRADING", params: { minutesBefore, minutesAfter } };

/** The Fed's December 2026 decision and the ECB's, as newsWindowsFromIRD gives them. */
export const FED: NewsEvent = { bank: "fed", currency: "USD", t: "2026-12-09T19:00:00.000Z", name: "Federal Reserve" };
export const ECB: NewsEvent = {
  bank: "ecb",
  currency: "EUR",
  t: "2026-12-17T13:15:00.000Z",
  name: "European Central Bank",
};
