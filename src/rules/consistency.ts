import type { AccountState, DayRecord } from "../account.js";
import { consistencyPercent, requiredProfitForConsistency } from "../helpers.js";
import { isAtMost } from "../math.js";
import { dayKeyOf } from "../time.js";
import type { ConsistencyProgress } from "../types.js";
import type { ParamsOf } from "./shared.js";

type Params = ParamsOf<"CONSISTENCY">;

/** The most profitable day (the earliest on a tie), or undefined if no day made a profit. */
function bestDay(state: AccountState): DayRecord | undefined {
  return state.days.reduce<DayRecord | undefined>(
    (best, day) => (day.profit > (best?.profit ?? 0) ? day : best),
    undefined,
  );
}

function bestDayPercent(state: AccountState): number | null {
  return consistencyPercent(state.days.map((day) => day.profit));
}

/** Met when total profit is positive and the best day is at most maxDayPercent of it. */
export function consistencyMet(params: Params, state: AccountState): boolean {
  const percent = bestDayPercent(state);
  return percent !== null && isAtMost(percent, params.maxDayPercent);
}

export function consistencyProgress(params: Params, state: AccountState): ConsistencyProgress {
  const best = bestDay(state);
  const bestDayProfit = best?.profit ?? 0;
  return {
    code: "CONSISTENCY",
    maxDayPercent: params.maxDayPercent,
    bestDay: best ? dayKeyOf(best.index) : null,
    bestDayProfit,
    totalProfit: state.closedProfit,
    bestDayPercent: bestDayPercent(state),
    requiredTotalProfit: requiredProfitForConsistency(bestDayProfit, params.maxDayPercent),
    met: consistencyMet(params, state),
  };
}
