/**
 * A point in time: an ISO 8601 string, a `Date`, or epoch milliseconds.
 * ISO strings without a timezone (`2026-03-02T10:00:00`) are read as UTC.
 */
export type TimeInput = string | number | Date;

/** The state of the account at one moment. */
export interface AccountSnapshot {
  /** When the snapshot was taken. */
  time: TimeInput;
  /** Closed balance: starting balance plus realised P&L. */
  balance: number;
  /** Balance plus the floating P&L of open positions. */
  equity: number;
}

/** One trade (position). Only needed to count trading days and daily profit exactly. */
export interface Trade {
  /** When the position was opened. The trading day of this time is counted as traded. */
  openTime: TimeInput;
  /** When the position was closed. Omit it, or pass `null`, while the position is open. */
  closeTime?: TimeInput | null;
  /** Net realised P&L, after commission and swap. Required once `closeTime` is set. */
  profit?: number;
  /**
   * The instrument traded (`EURUSD`, `XAUUSD`, `US30.cash`). Only NEWS_TRADING reads it:
   * a trade without one is not checked against the news.
   */
  symbol?: string;
}

/**
 * A scheduled release, such as a central bank rate decision. NEWS_TRADING puts a
 * window around `t` and checks the trades of instruments in `currency`.
 * `newsWindowsFromIRD` builds these from InterestRateDecision.com's open data.
 */
export interface NewsEvent {
  /** Who releases it (`fed`, `ecb`, `boe`...). Shown in breach messages. */
  bank: string;
  /** The currency it moves, as an ISO 4217 code: `USD`, `EUR`. */
  currency: string;
  /** When it is released. */
  t: TimeInput;
  /** A readable name for messages, such as "Federal Reserve". Defaults to `bank`. */
  name?: string;
}

/**
 * Where the trading day starts, as the server's UTC offset in minutes: the day
 * resets at 00:00 in that offset. `0` resets at 00:00 UTC, `120` at 00:00 UTC+2
 * (22:00 UTC). Pass a function for offsets that change with daylight saving time,
 * such as `newYorkCloseOffset`.
 */
export type DayResetOffset = number | ((time: Date) => number);

/** Which amount the MAX_DAILY_LOSS percent is taken of. */
export type DailyLossBasis =
  /** maxPercent of the starting balance, measured from the day-start balance. */
  | "starting_balance"
  /** maxPercent of the day-start balance, measured from the day-start balance. */
  | "day_start_balance"
  /** maxPercent of the higher of day-start balance and equity, measured from that level. */
  | "day_start_equity_or_balance_higher";

/** Which peak the TRAILING_DRAWDOWN floor follows. */
export type TrailingSource =
  /** The highest equity seen, including floating profit (intraday trailing). */
  | "equity"
  /** The highest closed balance seen. */
  | "balance"
  /** The highest closing balance of a finished trading day (end-of-day trailing). */
  | "end_of_day_balance";

/** Pass when the closed balance reaches the starting balance plus targetPercent. */
export interface ProfitTargetRule {
  code: "PROFIT_TARGET";
  params: { targetPercent: number };
}

/** Fail when equity falls below the day's floor. */
export interface MaxDailyLossRule {
  code: "MAX_DAILY_LOSS";
  params: { maxPercent: number; basis?: DailyLossBasis };
}

/** Fail when equity falls below the starting balance minus maxPercent of it. */
export interface MaxOverallLossRule {
  code: "MAX_OVERALL_LOSS";
  params: { maxPercent: number };
}

/** Fail when equity falls below the high-water mark minus maxPercent of the starting balance. */
export interface TrailingDrawdownRule {
  code: "TRAILING_DRAWDOWN";
  params: { maxPercent: number; trailOn?: TrailingSource; lockAtStart?: boolean };
}

/** Passing also needs trades on at least minDays distinct trading days. */
export interface MinTradingDaysRule {
  code: "MIN_TRADING_DAYS";
  params: { minDays: number };
}

/** Fail when the account trades on more than maxDays distinct trading days without passing. */
export interface MaxTradingDaysRule {
  code: "MAX_TRADING_DAYS";
  params: { maxDays: number };
}

/** Passing also needs the best day's profit to be at most maxDayPercent of the total profit. */
export interface ConsistencyRule {
  code: "CONSISTENCY";
  params: { maxDayPercent: number };
}

/**
 * Fail when a trade is opened or closed less than minutesBefore before, or less
 * than minutesAfter after, a news event in one of the instrument's currencies.
 */
export interface NewsTradingRule {
  code: "NEWS_TRADING";
  params: {
    minutesBefore: number;
    /** Defaults to minutesBefore. */
    minutesAfter?: number;
    /**
     * Currencies of instruments that are not currency pairs, or overrides:
     * `{ "US30": ["USD"], "GER40": ["EUR"] }`. Merged over DEFAULT_INSTRUMENTS.
     */
    instruments?: Readonly<Record<string, readonly string[]>>;
  };
}

/** A challenge rule. Percent params are percents: 5 means 5%. */
export type Rule =
  | ProfitTargetRule
  | MaxDailyLossRule
  | MaxOverallLossRule
  | TrailingDrawdownRule
  | MinTradingDaysRule
  | MaxTradingDaysRule
  | ConsistencyRule
  | NewsTradingRule;

export type RuleCode = Rule["code"];

export interface ChallengeInput {
  /** The account's starting (initial) balance. */
  startingBalance: number;
  /** The rules to apply. When two rules break at the same moment, breaches follow this order. */
  rules: readonly Rule[];
  /** Account snapshots in time order. The account is flat at startingBalance before the first one. */
  snapshots: readonly AccountSnapshot[];
  /**
   * Trades, in any order. When given, trading days are the days a trade was
   * opened and daily profit is the profit of trades closed that day. When
   * omitted, both are read from balance changes between snapshots.
   */
  trades?: readonly Trade[];
  /** When the trading day resets. Defaults to 0 (00:00 UTC). */
  dayResetUtcOffsetMinutes?: DayResetOffset;
  /** The news NEWS_TRADING checks trades against, in any order. Required with that rule. */
  newsEvents?: readonly NewsEvent[];
}

export type ChallengeStatus = "passed" | "failed" | "in_progress";

/** A rule broken at the moment the challenge failed. */
export interface Breach {
  code: RuleCode;
  /** When it happened (ISO 8601, UTC). */
  time: string;
  /** The trading day it happened on (YYYY-MM-DD, reset-adjusted). */
  day: string;
  /**
   * The limit: an equity floor for loss rules, a number of days for MAX_TRADING_DAYS,
   * the minutes a trade must keep from the news for NEWS_TRADING.
   */
  limit: number;
  /**
   * The value that broke it: equity for loss rules, days traded for MAX_TRADING_DAYS,
   * the minutes between the trade and the news for NEWS_TRADING.
   */
  value: number;
  message: string;
  /** NEWS_TRADING only: the index in `trades` of the trade that broke it. */
  trade?: number;
  /** NEWS_TRADING only: the news it was too close to. */
  news?: NewsWindow;
}

export interface ProfitTargetProgress {
  code: "PROFIT_TARGET";
  targetPercent: number;
  /** The closed balance that passes the target. */
  targetBalance: number;
  /** The profit the target needs. */
  targetProfit: number;
  /** Closed profit so far: balance minus starting balance. */
  profit: number;
  /** Profit still needed (0 once met). */
  remaining: number;
  met: boolean;
}

export interface MaxDailyLossProgress {
  code: "MAX_DAILY_LOSS";
  maxPercent: number;
  basis: DailyLossBasis;
  /** The current trading day (YYYY-MM-DD), or null before the first snapshot or trade. */
  day: string | null;
  dayStartBalance: number;
  dayStartEquity: number;
  /** The level today's loss is measured from. */
  dayStartLevel: number;
  /** How much may be lost today. */
  allowedLoss: number;
  /** Equity must stay at or above this today. */
  floor: number;
  /** How much is currently lost today: dayStartLevel minus equity, never below 0. */
  lossToday: number;
  /** Equity minus floor: how much more can be lost right now. Negative once breached. */
  distanceToFloor: number;
}

export interface MaxOverallLossProgress {
  code: "MAX_OVERALL_LOSS";
  maxPercent: number;
  allowedLoss: number;
  floor: number;
  distanceToFloor: number;
}

export interface TrailingDrawdownProgress {
  code: "TRAILING_DRAWDOWN";
  maxPercent: number;
  trailOn: TrailingSource;
  lockAtStart: boolean;
  /** The peak the floor trails. Starts at the starting balance. */
  highWaterMark: number;
  floor: number;
  /** True once lockAtStart has stopped the floor at the starting balance. */
  locked: boolean;
  distanceToFloor: number;
}

export interface MinTradingDaysProgress {
  code: "MIN_TRADING_DAYS";
  minDays: number;
  daysTraded: number;
  remaining: number;
  met: boolean;
}

export interface MaxTradingDaysProgress {
  code: "MAX_TRADING_DAYS";
  maxDays: number;
  daysTraded: number;
  /** Trading days left before the limit (0 on the last allowed day). */
  remaining: number;
}

export interface ConsistencyProgress {
  code: "CONSISTENCY";
  maxDayPercent: number;
  /** The most profitable trading day (YYYY-MM-DD), or null if no day made a profit. */
  bestDay: string | null;
  bestDayProfit: number;
  /** Net closed profit over all days. */
  totalProfit: number;
  /** The best day as a percent of total profit, or null while total profit is 0 or less. */
  bestDayPercent: number | null;
  /** The total profit at which the best day would be exactly maxDayPercent of it. */
  requiredTotalProfit: number;
  met: boolean;
}

/** The window NEWS_TRADING keeps trades out of, around one news event. */
export interface NewsWindow {
  bank: string;
  name: string;
  currency: string;
  /** The release (ISO 8601, UTC). */
  time: string;
  /** No trade may be opened or closed after this... */
  start: string;
  /** ...and before this. A trade exactly at either edge is allowed. */
  end: string;
}

export interface NewsTradingProgress {
  code: "NEWS_TRADING";
  minutesBefore: number;
  minutesAfter: number;
  /** How many news events were given. */
  events: number;
  /** Trade opens and closes checked so far: their instrument has a known currency. */
  checked: number;
  /** Trade opens and closes not checked: no symbol, or a symbol with no known currency. */
  unchecked: number;
  /** The symbols that were not checked, so you can add them to `instruments`. */
  uncheckedSymbols: string[];
  /** The first window not yet over at the last event, in any currency; null when none is left. */
  nextWindow: NewsWindow | null;
}

export type RuleProgress =
  | ProfitTargetProgress
  | MaxDailyLossProgress
  | MaxOverallLossProgress
  | TrailingDrawdownProgress
  | MinTradingDaysProgress
  | MaxTradingDaysProgress
  | ConsistencyProgress
  | NewsTradingProgress;

/** One trading day of the evaluated history. */
export interface DaySummary {
  /** The trading day (YYYY-MM-DD, reset-adjusted). */
  day: string;
  startBalance: number;
  startEquity: number;
  endBalance: number;
  endEquity: number;
  lowestEquity: number;
  highestEquity: number;
  /** Closed profit that day: from trades closed that day, or from the balance change. */
  profit: number;
  /** Whether the day counts as a trading day. */
  traded: boolean;
}

export interface ChallengeMetrics {
  balance: number;
  equity: number;
  /** Closed profit: balance minus starting balance. */
  profit: number;
  /** Profit as a percent of the starting balance. */
  profitPercent: number;
  /** The highest equity seen, including the starting balance. */
  highWaterMark: number;
  lowestEquity: number;
  /** The largest fall in equity from a previous equity peak. */
  maxDrawdown: number;
  /** maxDrawdown as a percent of the starting balance. */
  maxDrawdownPercent: number;
  tradingDays: number;
  days: DaySummary[];
}

export interface ChallengeResult {
  status: ChallengeStatus;
  /** When the challenge passed or failed (ISO 8601, UTC); null while in progress. */
  endedAt: string | null;
  /** Every rule broken at the moment the challenge failed, in rule order. Empty unless failed. */
  breaches: Breach[];
  /** One entry per rule, in rule order, as of endedAt or the last snapshot or trade. */
  progress: RuleProgress[];
  metrics: ChallengeMetrics;
}
