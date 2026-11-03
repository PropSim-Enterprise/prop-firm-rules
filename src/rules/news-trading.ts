import { type AccountState, tradeEventsNow } from "../account.js";
import { tidy } from "../math.js";
import { instrumentCurrencies, isInWindow, newsWindow, type ResolvedNews, windowEnd } from "../news.js";
import { toIso } from "../time.js";
import type { TradeCloseEvent, TradeOpenEvent } from "../timeline.js";
import type { NewsTradingProgress, NewsWindow } from "../types.js";
import type { BreachDraft, ParamsOf } from "./shared.js";

type Params = ParamsOf<"NEWS_TRADING">;
type TradeEvent = TradeOpenEvent | TradeCloseEvent;

const MINUTE_MS = 60_000;

function currenciesOf(event: TradeEvent, params: Params): string[] {
  return event.symbol === null ? [] : instrumentCurrencies(event.symbol, params.instruments);
}

/** The first news event whose window the trade event falls in. */
function newsHit(event: TradeEvent, params: Params, news: readonly ResolvedNews[]): ResolvedNews | undefined {
  const currencies = currenciesOf(event, params);
  if (currencies.length === 0) return undefined;
  return news.find((item) => currencies.includes(item.currency) && isInWindow(event.time, item, params));
}

function minutesText(minutes: number): string {
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Broken the moment a trade is opened or closed inside a window of one of its currencies. */
export function newsTradingBreach(
  params: Params,
  state: AccountState,
  news: readonly ResolvedNews[],
): BreachDraft | null {
  for (const event of tradeEventsNow(state)) {
    const hit = newsHit(event, params, news);
    if (!hit) continue;
    const before = event.time <= hit.time;
    const minutes = tidy(Math.abs(hit.time - event.time) / MINUTE_MS);
    const limit = before ? params.minutesBefore : params.minutesAfter;
    const action = event.kind === "open" ? "opened" : "closed";
    const side = before ? "before" : "after";
    return {
      limit,
      value: minutes,
      message:
        `${event.symbol} trade ${action} ${minutesText(minutes)} ${side} the ${hit.name} announcement ` +
        `(${hit.currency}) at ${toIso(hit.time)}; trades must keep ${minutesText(limit)} ${side} it`,
      trade: event.trade,
      news: newsWindow(hit, params),
    };
  }
  return null;
}

function nextWindow(params: Params, state: AccountState, news: readonly ResolvedNews[]): NewsWindow | null {
  const now = state.time ?? Number.NEGATIVE_INFINITY;
  const next = news.find((item) => windowEnd(item, params) > now);
  return next ? newsWindow(next, params) : null;
}

export function newsTradingProgress(
  params: Params,
  state: AccountState,
  news: readonly ResolvedNews[],
): NewsTradingProgress {
  const unchecked = state.tradeEvents.filter((event) => currenciesOf(event, params).length === 0);
  const symbols = unchecked.map((event) => event.symbol).filter((symbol): symbol is string => symbol !== null);
  return {
    code: "NEWS_TRADING",
    minutesBefore: params.minutesBefore,
    minutesAfter: params.minutesAfter,
    events: news.length,
    checked: state.tradeEvents.length - unchecked.length,
    unchecked: unchecked.length,
    uncheckedSymbols: [...new Set(symbols)],
    nextWindow: nextWindow(params, state, news),
  };
}
