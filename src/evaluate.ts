import {
  type AccountState,
  type ActivitySource,
  applyEvent,
  createAccount,
  currentDay,
  type DayRecord,
  enterDay,
} from "./account.js";
import { InvalidInputError } from "./errors.js";
import { tidy } from "./math.js";
import { type ResolvedRule, resolveRules } from "./parse-rules.js";
import { ruleBreach, ruleMet, ruleProgress } from "./rules/index.js";
import { dayIndexOf, dayKeyOf, offsetResolver, toIso } from "./time.js";
import { buildTimeline, type TimelineEvent } from "./timeline.js";
import type {
  Breach,
  ChallengeInput,
  ChallengeMetrics,
  ChallengeResult,
  ChallengeStatus,
  DaySummary,
} from "./types.js";
import { isRecord, positiveNumber } from "./validate.js";

interface Setup {
  startingBalance: number;
  rules: ResolvedRule[];
  events: TimelineEvent[];
  dayOf: (ms: number) => number;
  source: ActivitySource;
  /** Without a PROFIT_TARGET there is nothing to pass (a funded account): it can only fail. */
  canPass: boolean;
}

interface Outcome {
  status: ChallengeStatus;
  breaches: Breach[];
  /** Epoch ms of the moment the challenge passed or failed. */
  endedAt: number | null;
}

const IN_PROGRESS: Outcome = { status: "in_progress", breaches: [], endedAt: null };

function prepare(input: ChallengeInput): Setup {
  if (!isRecord(input)) throw new InvalidInputError("input must be an object");
  const rules = resolveRules(input.rules);
  const offsetAt = offsetResolver(input.dayResetUtcOffsetMinutes);
  return {
    startingBalance: positiveNumber(input.startingBalance, "startingBalance"),
    rules,
    events: buildTimeline(input.snapshots, input.trades),
    dayOf: (ms) => dayIndexOf(ms, offsetAt),
    source: input.trades === undefined || input.trades === null ? "balance" : "trades",
    canPass: rules.some((rule) => rule.code === "PROFIT_TARGET"),
  };
}

function breachAt(rule: ResolvedRule, state: AccountState, time: number): Breach | null {
  const draft = ruleBreach(rule, state);
  if (!draft) return null;
  const dayIndex = currentDay(state)?.index ?? 0;
  return { code: rule.code, time: toIso(time), day: dayKeyOf(dayIndex), ...draft };
}

/** Breaches first: a rule broken at the same moment the target is reached still fails the challenge. */
function checkPoint(setup: Setup, state: AccountState, time: number): Outcome | null {
  const breaches = setup.rules
    .map((rule) => breachAt(rule, state, time))
    .filter((breach): breach is Breach => breach !== null);
  if (breaches.length > 0) return { status: "failed", breaches, endedAt: time };
  if (setup.canPass && setup.rules.every((rule) => ruleMet(rule, state))) {
    return { status: "passed", breaches: [], endedAt: time };
  }
  return null;
}

/**
 * Rules are checked after every snapshot, and after trades that have no
 * snapshot at the same instant (the snapshot reflects them, so it is checked instead).
 */
function isCheckPoint(event: TimelineEvent, next: TimelineEvent | undefined): boolean {
  return event.kind === "snapshot" || next === undefined || next.time !== event.time;
}

/** Replays the timeline until the challenge passes or fails. The first moment either happens wins. */
function replay(setup: Setup, state: AccountState): Outcome {
  const { events } = setup;
  for (const [i, event] of events.entries()) {
    enterDay(state, setup.dayOf(event.time));
    applyEvent(state, event, setup.source);
    const outcome = isCheckPoint(event, events[i + 1]) ? checkPoint(setup, state, event.time) : null;
    if (outcome) return outcome;
  }
  return IN_PROGRESS;
}

function daySummary(day: DayRecord): DaySummary {
  return {
    day: dayKeyOf(day.index),
    startBalance: day.startBalance,
    startEquity: day.startEquity,
    endBalance: day.endBalance,
    endEquity: day.endEquity,
    lowestEquity: day.lowestEquity,
    highestEquity: day.highestEquity,
    profit: day.profit,
    traded: day.traded,
  };
}

function metricsOf(state: AccountState): ChallengeMetrics {
  const start = state.startingBalance;
  const profit = state.balance - start;
  return {
    balance: state.balance,
    equity: state.equity,
    profit,
    profitPercent: (profit / start) * 100,
    highWaterMark: state.equityPeak,
    lowestEquity: state.lowestEquity,
    maxDrawdown: state.maxDrawdown,
    maxDrawdownPercent: (state.maxDrawdown / start) * 100,
    tradingDays: state.tradingDays,
    days: state.days.map(daySummary),
  };
}

/** Rounds floating point noise out of every number in the result. */
function tidyNumbers<T>(value: T): T {
  if (typeof value === "number") return tidy(value) as T;
  if (Array.isArray(value)) return value.map(tidyNumbers) as T;
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, tidyNumbers(item)])) as T;
}

/**
 * Evaluates prop firm challenge rules against an account's history.
 *
 * The history is replayed in time order. The challenge fails at the first
 * moment any limit rule is broken (MAX_DAILY_LOSS, MAX_OVERALL_LOSS,
 * TRAILING_DRAWDOWN, MAX_TRADING_DAYS) and passes at the first moment every
 * objective is met (PROFIT_TARGET, plus MIN_TRADING_DAYS and CONSISTENCY when
 * present). Data after that moment is ignored. Throws InvalidInputError on bad input.
 */
export function evaluateChallenge(input: ChallengeInput): ChallengeResult {
  const setup = prepare(input);
  const state = createAccount(setup.startingBalance);
  const outcome = replay(setup, state);
  return tidyNumbers({
    status: outcome.status,
    endedAt: outcome.endedAt === null ? null : toIso(outcome.endedAt),
    breaches: outcome.breaches,
    progress: setup.rules.map((rule) => ruleProgress(rule, state)),
    metrics: metricsOf(state),
  });
}
