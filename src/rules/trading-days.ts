import type { AccountState } from "../account.js";
import type { MaxTradingDaysProgress, MinTradingDaysProgress } from "../types.js";
import type { BreachDraft, ParamsOf } from "./shared.js";

type MinParams = ParamsOf<"MIN_TRADING_DAYS">;
type MaxParams = ParamsOf<"MAX_TRADING_DAYS">;

export function minTradingDaysMet(params: MinParams, state: AccountState): boolean {
  return state.tradingDays >= params.minDays;
}

export function minTradingDaysProgress(params: MinParams, state: AccountState): MinTradingDaysProgress {
  return {
    code: "MIN_TRADING_DAYS",
    minDays: params.minDays,
    daysTraded: state.tradingDays,
    remaining: Math.max(0, params.minDays - state.tradingDays),
    met: minTradingDaysMet(params, state),
  };
}

/** Broken when the account starts trading on day maxDays + 1 without having passed. */
export function maxTradingDaysBreach(params: MaxParams, state: AccountState): BreachDraft | null {
  if (state.tradingDays <= params.maxDays) return null;
  return {
    limit: params.maxDays,
    value: state.tradingDays,
    message: `Traded on ${state.tradingDays} days without passing; the limit is ${params.maxDays} trading days`,
  };
}

export function maxTradingDaysProgress(params: MaxParams, state: AccountState): MaxTradingDaysProgress {
  return {
    code: "MAX_TRADING_DAYS",
    maxDays: params.maxDays,
    daysTraded: state.tradingDays,
    remaining: Math.max(0, params.maxDays - state.tradingDays),
  };
}
