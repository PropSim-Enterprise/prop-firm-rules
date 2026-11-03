import type { AccountState } from "../account.js";
import type { ResolvedNews } from "../news.js";
import type { ResolvedRule } from "../parse-rules.js";
import type { RuleProgress } from "../types.js";
import { consistencyMet, consistencyProgress } from "./consistency.js";
import { dailyLossBreach, dailyLossProgress } from "./daily-loss.js";
import { newsTradingBreach, newsTradingProgress } from "./news-trading.js";
import { overallLossBreach, overallLossProgress } from "./overall-loss.js";
import { profitTargetMet, profitTargetProgress } from "./profit-target.js";
import type { BreachDraft } from "./shared.js";
import { trailingDrawdownBreach, trailingDrawdownProgress } from "./trailing-drawdown.js";
import {
  maxTradingDaysBreach,
  maxTradingDaysProgress,
  minTradingDaysMet,
  minTradingDaysProgress,
} from "./trading-days.js";

export type { BreachDraft } from "./shared.js";

/** What rules read besides the account: the news events, sorted by time. */
export interface RuleContext {
  news: readonly ResolvedNews[];
}

/** Limit rules: is the rule broken right now? Objective rules never break. */
export function ruleBreach(rule: ResolvedRule, state: AccountState, context: RuleContext): BreachDraft | null {
  switch (rule.code) {
    case "MAX_DAILY_LOSS":
      return dailyLossBreach(rule.params, state);
    case "MAX_OVERALL_LOSS":
      return overallLossBreach(rule.params, state);
    case "TRAILING_DRAWDOWN":
      return trailingDrawdownBreach(rule.params, state);
    case "MAX_TRADING_DAYS":
      return maxTradingDaysBreach(rule.params, state);
    case "NEWS_TRADING":
      return newsTradingBreach(rule.params, state, context.news);
    default:
      return null;
  }
}

/** Objective rules: is the objective met right now? Limit rules don't block a pass. */
export function ruleMet(rule: ResolvedRule, state: AccountState): boolean {
  switch (rule.code) {
    case "PROFIT_TARGET":
      return profitTargetMet(rule.params, state);
    case "MIN_TRADING_DAYS":
      return minTradingDaysMet(rule.params, state);
    case "CONSISTENCY":
      return consistencyMet(rule.params, state);
    default:
      return true;
  }
}

export function ruleProgress(rule: ResolvedRule, state: AccountState, context: RuleContext): RuleProgress {
  switch (rule.code) {
    case "PROFIT_TARGET":
      return profitTargetProgress(rule.params, state);
    case "MAX_DAILY_LOSS":
      return dailyLossProgress(rule.params, state);
    case "MAX_OVERALL_LOSS":
      return overallLossProgress(rule.params, state);
    case "TRAILING_DRAWDOWN":
      return trailingDrawdownProgress(rule.params, state);
    case "MIN_TRADING_DAYS":
      return minTradingDaysProgress(rule.params, state);
    case "MAX_TRADING_DAYS":
      return maxTradingDaysProgress(rule.params, state);
    case "CONSISTENCY":
      return consistencyProgress(rule.params, state);
    case "NEWS_TRADING":
      return newsTradingProgress(rule.params, state, context.news);
  }
}
