import type { SnapshotEvent, TimelineEvent, TradeCloseEvent, TradeOpenEvent } from "./timeline.js";

/** Where trading days and daily profit come from. */
export type ActivitySource = "trades" | "balance";

export interface DayRecord {
  index: number;
  startBalance: number;
  startEquity: number;
  endBalance: number;
  endEquity: number;
  lowestEquity: number;
  highestEquity: number;
  profit: number;
  traded: boolean;
}

/** The account as of the last applied event. */
export interface AccountState {
  readonly startingBalance: number;
  balance: number;
  equity: number;
  equityPeak: number;
  balancePeak: number;
  /** Highest closing balance of a finished trading day (or the starting balance). */
  closedDayBalancePeak: number;
  lowestEquity: number;
  maxDrawdown: number;
  /** Net closed profit from the activity source. */
  closedProfit: number;
  tradingDays: number;
  /** Trading days seen so far, oldest first. The last one is the current day. */
  days: DayRecord[];
  /** Epoch ms of the last applied event, or null before the first. */
  time: number | null;
  /** Every trade open and close applied so far, in time order. */
  tradeEvents: (TradeOpenEvent | TradeCloseEvent)[];
}

/** A flat account at its starting balance, before any snapshot or trade. */
export function createAccount(startingBalance: number): AccountState {
  return {
    startingBalance,
    balance: startingBalance,
    equity: startingBalance,
    equityPeak: startingBalance,
    balancePeak: startingBalance,
    closedDayBalancePeak: startingBalance,
    lowestEquity: startingBalance,
    maxDrawdown: 0,
    closedProfit: 0,
    tradingDays: 0,
    days: [],
    time: null,
    tradeEvents: [],
  };
}

export function currentDay(state: AccountState): DayRecord | undefined {
  return state.days[state.days.length - 1];
}

function today(state: AccountState): DayRecord {
  const day = currentDay(state);
  if (day) return day;
  throw new Error("prop-firm-rules: an event was applied before its trading day started");
}

/**
 * Starts a new trading day if dayIndex is later than the current one. The new
 * day starts from the account as it was at the reset: the last known balance and
 * equity. Days never go backwards, so an odd offset function can't reopen a day.
 */
export function enterDay(state: AccountState, dayIndex: number): void {
  const previous = currentDay(state);
  if (previous && dayIndex <= previous.index) return;
  if (previous) state.closedDayBalancePeak = Math.max(state.closedDayBalancePeak, state.balance);
  state.days.push({
    index: dayIndex,
    startBalance: state.balance,
    startEquity: state.equity,
    endBalance: state.balance,
    endEquity: state.equity,
    lowestEquity: state.equity,
    highestEquity: state.equity,
    profit: 0,
    traded: false,
  });
}

function markTraded(state: AccountState): void {
  const day = today(state);
  if (day.traded) return;
  day.traded = true;
  state.tradingDays += 1;
}

function addProfit(state: AccountState, amount: number): void {
  today(state).profit += amount;
  state.closedProfit += amount;
}

function trackExtremes(state: AccountState): void {
  state.equityPeak = Math.max(state.equityPeak, state.equity);
  state.balancePeak = Math.max(state.balancePeak, state.balance);
  state.lowestEquity = Math.min(state.lowestEquity, state.equity);
  state.maxDrawdown = Math.max(state.maxDrawdown, state.equityPeak - state.equity);
}

function trackDay(day: DayRecord, snapshot: SnapshotEvent): void {
  day.endBalance = snapshot.balance;
  day.endEquity = snapshot.equity;
  day.lowestEquity = Math.min(day.lowestEquity, snapshot.equity);
  day.highestEquity = Math.max(day.highestEquity, snapshot.equity);
}

function applySnapshot(state: AccountState, snapshot: SnapshotEvent, source: ActivitySource): void {
  const balanceChange = snapshot.balance - state.balance;
  state.balance = snapshot.balance;
  state.equity = snapshot.equity;
  trackExtremes(state);
  trackDay(today(state), snapshot);
  if (source === "balance" && balanceChange !== 0) {
    markTraded(state);
    addProfit(state, balanceChange);
  }
}

/** Applies one event. Call enterDay with the event's trading day first. */
export function applyEvent(state: AccountState, event: TimelineEvent, source: ActivitySource): void {
  state.time = event.time;
  if (event.kind === "snapshot") return applySnapshot(state, event, source);
  state.tradeEvents.push(event);
  if (event.kind === "open") markTraded(state);
  else addProfit(state, event.profit);
}

/** The trade opens and closes at the instant of the last applied event. */
export function tradeEventsNow(state: AccountState): (TradeOpenEvent | TradeCloseEvent)[] {
  const now: (TradeOpenEvent | TradeCloseEvent)[] = [];
  for (let i = state.tradeEvents.length - 1; i >= 0; i -= 1) {
    const event = state.tradeEvents[i];
    if (!event || event.time !== state.time) break;
    now.unshift(event);
  }
  return now;
}
