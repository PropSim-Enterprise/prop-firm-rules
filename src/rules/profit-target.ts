import type { AccountState } from "../account.js";
import { profitTargetBalance } from "../helpers.js";
import { isAtLeast } from "../math.js";
import type { ProfitTargetProgress } from "../types.js";
import type { ParamsOf } from "./shared.js";

type Params = ParamsOf<"PROFIT_TARGET">;

/** Met when the closed balance reaches the target. Floating profit doesn't count. */
export function profitTargetMet(params: Params, state: AccountState): boolean {
  return isAtLeast(state.balance, profitTargetBalance(state.startingBalance, params.targetPercent));
}

export function profitTargetProgress(params: Params, state: AccountState): ProfitTargetProgress {
  const targetBalance = profitTargetBalance(state.startingBalance, params.targetPercent);
  return {
    code: "PROFIT_TARGET",
    targetPercent: params.targetPercent,
    targetBalance,
    targetProfit: targetBalance - state.startingBalance,
    profit: state.balance - state.startingBalance,
    remaining: Math.max(0, targetBalance - state.balance),
    met: profitTargetMet(params, state),
  };
}
