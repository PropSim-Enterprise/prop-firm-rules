import { InvalidInputError } from "./errors.js";
import type { DailyLossBasis, Rule, RuleCode, TrailingSource } from "./types.js";
import { describe, isRecord, percentNumber, positiveNumber } from "./validate.js";

type Resolve<R> = R extends Rule ? { code: R["code"]; params: Required<R["params"]> } : never;

/** A rule with every optional param filled in with its default. */
export type ResolvedRule = Resolve<Rule>;

/** A rule as loosely typed config (JSON, a database row, a landing page template config). */
export interface RuleLike {
  code: string;
  params?: Readonly<Record<string, unknown>> | null;
}

export interface ParseRulesOptions {
  /** Skip rules whose code this library doesn't know instead of throwing. Defaults to false. */
  ignoreUnknown?: boolean;
}

type Params = Readonly<Record<string, unknown>>;

const DAILY_LOSS_BASES = [
  "starting_balance",
  "day_start_balance",
  "day_start_equity_or_balance_higher",
] as const satisfies readonly DailyLossBasis[];
const TRAILING_SOURCES = ["equity", "balance", "end_of_day_balance"] as const satisfies readonly TrailingSource[];

function wholeDays(value: unknown, label: string): number {
  const days = positiveNumber(value, label);
  if (Number.isInteger(days)) return days;
  throw new InvalidInputError(`${label} must be a whole number of days, got ${describe(value)}`);
}

function choice<T extends string>(value: unknown, label: string, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if ((allowed as readonly unknown[]).includes(value)) return value as T;
  throw new InvalidInputError(`${label} must be one of ${allowed.join(", ")}, got ${describe(value)}`);
}

function flag(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  throw new InvalidInputError(`${label} must be true or false, got ${describe(value)}`);
}

const PARSERS: { readonly [C in RuleCode]: (p: Params) => ResolvedRule } = {
  PROFIT_TARGET: (p) => ({
    code: "PROFIT_TARGET",
    params: { targetPercent: positiveNumber(p.targetPercent, "PROFIT_TARGET.targetPercent") },
  }),
  MAX_DAILY_LOSS: (p) => ({
    code: "MAX_DAILY_LOSS",
    params: {
      maxPercent: percentNumber(p.maxPercent, "MAX_DAILY_LOSS.maxPercent"),
      basis: choice(p.basis, "MAX_DAILY_LOSS.basis", DAILY_LOSS_BASES, "starting_balance"),
    },
  }),
  MAX_OVERALL_LOSS: (p) => ({
    code: "MAX_OVERALL_LOSS",
    params: { maxPercent: percentNumber(p.maxPercent, "MAX_OVERALL_LOSS.maxPercent") },
  }),
  TRAILING_DRAWDOWN: (p) => ({
    code: "TRAILING_DRAWDOWN",
    params: {
      maxPercent: percentNumber(p.maxPercent, "TRAILING_DRAWDOWN.maxPercent"),
      trailOn: choice(p.trailOn, "TRAILING_DRAWDOWN.trailOn", TRAILING_SOURCES, "equity"),
      lockAtStart: flag(p.lockAtStart, "TRAILING_DRAWDOWN.lockAtStart"),
    },
  }),
  MIN_TRADING_DAYS: (p) => ({
    code: "MIN_TRADING_DAYS",
    params: { minDays: wholeDays(p.minDays, "MIN_TRADING_DAYS.minDays") },
  }),
  MAX_TRADING_DAYS: (p) => ({
    code: "MAX_TRADING_DAYS",
    params: { maxDays: wholeDays(p.maxDays, "MAX_TRADING_DAYS.maxDays") },
  }),
  CONSISTENCY: (p) => ({
    code: "CONSISTENCY",
    params: { maxDayPercent: percentNumber(p.maxDayPercent, "CONSISTENCY.maxDayPercent") },
  }),
};

export const RULE_CODES = Object.keys(PARSERS) as RuleCode[];

function isRuleCode(code: string): code is RuleCode {
  return Object.hasOwn(PARSERS, code);
}

/** A rule's params; a missing params object reads as {} so the required params report as missing. */
function paramsOf(rule: Params): Params {
  return isRecord(rule.params) ? rule.params : {};
}

function parseRule(rule: unknown, index: number, ignoreUnknown: boolean): ResolvedRule | null {
  if (!isRecord(rule) || typeof rule.code !== "string") {
    throw new InvalidInputError(`rules[${index}] must be an object with a string code`);
  }
  if (isRuleCode(rule.code)) return PARSERS[rule.code](paramsOf(rule));
  if (ignoreUnknown) return null;
  throw new InvalidInputError(
    `rules[${index}] has unknown code ${describe(rule.code)}; known codes: ${RULE_CODES.join(", ")}`,
  );
}

/** Validates rules and fills in defaults. Used by evaluateChallenge; exported for parseRules. */
export function resolveRules(rules: unknown, options: ParseRulesOptions = {}): ResolvedRule[] {
  if (!Array.isArray(rules)) throw new InvalidInputError("rules must be an array");
  const ignoreUnknown = options.ignoreUnknown === true;
  return rules
    .map((rule, index) => parseRule(rule, index, ignoreUnknown))
    .filter((rule): rule is ResolvedRule => rule !== null);
}

/**
 * Validates loosely typed rules (JSON, a database row, the rules in a
 * prop-firm-landing-page-templates config) and returns typed rules with every
 * default filled in. Each item should look like `{ code: string, params?: object }`
 * (see RuleLike). Throws InvalidInputError naming the bad rule and param.
 *
 * @example parseRules([{ code: "MAX_DAILY_LOSS", params: { maxPercent: 5 } }])
 * // [{ code: "MAX_DAILY_LOSS", params: { maxPercent: 5, basis: "starting_balance" } }]
 */
export function parseRules(rules: readonly RuleLike[] | readonly unknown[], options: ParseRulesOptions = {}): Rule[] {
  return resolveRules(rules, options);
}
