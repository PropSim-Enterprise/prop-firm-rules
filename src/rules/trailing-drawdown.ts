import type { AccountState } from "../account.js";
import { trailingDrawdownFloor } from "../helpers.js";
import { isAtLeast, isBelow } from "../math.js";
import type { TrailingDrawdownProgress } from "../types.js";
import { type BreachDraft, formatAmount, type ParamsOf } from "./shared.js";

type Params = ParamsOf<"TRAILING_DRAWDOWN">;

/** The peak the floor trails, by the rule's trailOn setting. All start at the starting balance. */
function highWaterMark(params: Params, state: AccountState): number {
  switch (params.trailOn) {
    case "balance":
      return state.balancePeak;
    case "end_of_day_balance":
      return state.closedDayBalancePeak;
    default:
      return state.equityPeak;
  }
}

function floorOf(params: Params, state: AccountState, lockAtStart: boolean): number {
  return trailingDrawdownFloor({
    highWaterMark: highWaterMark(params, state),
    startingBalance: state.startingBalance,
    maxPercent: params.maxPercent,
    lockAtStart,
  });
}

/** Broken the moment equity is below the trailing floor. */
export function trailingDrawdownBreach(params: Params, state: AccountState): BreachDraft | null {
  const floor = floorOf(params, state, params.lockAtStart);
  if (!isBelow(state.equity, floor)) return null;
  return {
    limit: floor,
    value: state.equity,
    message:
      `Equity ${formatAmount(state.equity)} fell below the trailing drawdown floor of ${formatAmount(floor)} ` +
      `(high-water mark ${formatAmount(highWaterMark(params, state))} minus ${params.maxPercent}% of the starting balance)`,
  };
}

export function trailingDrawdownProgress(params: Params, state: AccountState): TrailingDrawdownProgress {
  const floor = floorOf(params, state, params.lockAtStart);
  const unlockedFloor = floorOf(params, state, false);
  return {
    code: "TRAILING_DRAWDOWN",
    maxPercent: params.maxPercent,
    trailOn: params.trailOn,
    lockAtStart: params.lockAtStart,
    highWaterMark: highWaterMark(params, state),
    floor,
    locked: params.lockAtStart && isAtLeast(unlockedFloor, state.startingBalance),
    distanceToFloor: state.equity - floor,
  };
}
