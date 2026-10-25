import type { AccountState } from "../account.js";
import { maxLossFloor } from "../helpers.js";
import { isBelow } from "../math.js";
import type { MaxOverallLossProgress } from "../types.js";
import { type BreachDraft, formatAmount, type ParamsOf } from "./shared.js";

type Params = ParamsOf<"MAX_OVERALL_LOSS">;

/** Broken the moment equity is below the static floor. The floor never moves. */
export function overallLossBreach(params: Params, state: AccountState): BreachDraft | null {
  const floor = maxLossFloor(state.startingBalance, params.maxPercent);
  if (!isBelow(state.equity, floor)) return null;
  return {
    limit: floor,
    value: state.equity,
    message:
      `Equity ${formatAmount(state.equity)} fell below the maximum loss floor of ${formatAmount(floor)} ` +
      `(${params.maxPercent}% of the starting balance)`,
  };
}

export function overallLossProgress(params: Params, state: AccountState): MaxOverallLossProgress {
  const floor = maxLossFloor(state.startingBalance, params.maxPercent);
  return {
    code: "MAX_OVERALL_LOSS",
    maxPercent: params.maxPercent,
    allowedLoss: state.startingBalance - floor,
    floor,
    distanceToFloor: state.equity - floor,
  };
}
