import { tidy } from "../math.js";
import type { ResolvedRule } from "../parse-rules.js";
import type { NewsWindow, RuleCode } from "../types.js";

/** A breach before the engine stamps it with a code, time and day. */
export interface BreachDraft {
  limit: number;
  value: number;
  message: string;
  /** NEWS_TRADING only. */
  trade?: number;
  /** NEWS_TRADING only. */
  news?: NewsWindow;
}

/** The resolved params of the rule with this code. */
export type ParamsOf<C extends RuleCode> = Extract<ResolvedRule, { code: C }>["params"];

export function formatAmount(value: number): string {
  return tidy(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
