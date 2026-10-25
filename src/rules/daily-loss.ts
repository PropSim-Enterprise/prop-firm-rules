import { type AccountState, currentDay } from "../account.js";
import { type DailyLossLimit, dailyLossLimit } from "../helpers.js";
import { isBelow } from "../math.js";
import { dayKeyOf } from "../time.js";
import type { DailyLossBasis, MaxDailyLossProgress } from "../types.js";
import { type BreachDraft, formatAmount, type ParamsOf } from "./shared.js";

type Params = ParamsOf<"MAX_DAILY_LOSS">;

const BASIS_LABELS: Readonly<Record<DailyLossBasis, string>> = {
  starting_balance: "the starting balance",
  day_start_balance: "the day-start balance",
  day_start_equity_or_balance_higher: "the higher of day-start balance and equity",
};

/** Balance and equity at the start of the current trading day (the starting balance before day one). */
function dayStart(state: AccountState): { balance: number; equity: number } {
  const day = currentDay(state);
  if (!day) return { balance: state.startingBalance, equity: state.startingBalance };
  return { balance: day.startBalance, equity: day.startEquity };
}

function todaysLimit(params: Params, state: AccountState): DailyLossLimit {
  const start = dayStart(state);
  return dailyLossLimit({
    startingBalance: state.startingBalance,
    dayStartBalance: start.balance,
    dayStartEquity: start.equity,
    maxPercent: params.maxPercent,
    basis: params.basis,
  });
}

/** Broken the moment equity is below today's floor, even if it recovers before the day ends. */
export function dailyLossBreach(params: Params, state: AccountState): BreachDraft | null {
  const { floor } = todaysLimit(params, state);
  if (!isBelow(state.equity, floor)) return null;
  return {
    limit: floor,
    value: state.equity,
    message:
      `Equity ${formatAmount(state.equity)} fell below the daily loss floor of ${formatAmount(floor)} ` +
      `(${params.maxPercent}% of ${BASIS_LABELS[params.basis]})`,
  };
}

export function dailyLossProgress(params: Params, state: AccountState): MaxDailyLossProgress {
  const start = dayStart(state);
  const limit = todaysLimit(params, state);
  const day = currentDay(state);
  return {
    code: "MAX_DAILY_LOSS",
    maxPercent: params.maxPercent,
    basis: params.basis,
    day: day ? dayKeyOf(day.index) : null,
    dayStartBalance: start.balance,
    dayStartEquity: start.equity,
    dayStartLevel: limit.dayStartLevel,
    allowedLoss: limit.allowedLoss,
    floor: limit.floor,
    lossToday: Math.max(0, limit.dayStartLevel - state.equity),
    distanceToFloor: state.equity - limit.floor,
  };
}
