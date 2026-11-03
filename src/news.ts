/**
 * Which currencies an instrument trades, and the windows NEWS_TRADING keeps
 * trades out of. Pure: the news comes in as data (see newsWindowsFromIRD).
 */
import { InvalidInputError } from "./errors.js";
import { toIso, toMillis } from "./time.js";
import type { NewsEvent, NewsWindow } from "./types.js";
import { describe, isRecord } from "./validate.js";

const MINUTE_MS = 60_000;

/** Currencies a pair half can be. Metals trade like currencies (XAUUSD) and are read as USD. */
const CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "NOK", "SEK", "DKK", "PLN", "HUF", "CZK",
  "TRY", "ZAR", "MXN", "BRL", "CNH", "CNY", "HKD", "SGD", "INR", "KRW", "ILS", "THB", "RUB",
]);

/** Gold, silver, platinum and palladium are priced and moved in dollars: their news is the Fed's. */
const METALS: Readonly<Record<string, string>> = { XAU: "USD", XAG: "USD", XPT: "USD", XPD: "USD" };

/**
 * The currencies of common instruments that are not currency pairs. Keys are
 * matched against the start of the symbol, with anything but letters and digits
 * removed, so `US30.cash` and `GER40m` match. Override or extend them with the
 * NEWS_TRADING rule's `instruments` param.
 */
export const DEFAULT_INSTRUMENTS: Readonly<Record<string, readonly string[]>> = {
  US30: ["USD"],
  DJ30: ["USD"],
  US500: ["USD"],
  SPX500: ["USD"],
  US100: ["USD"],
  NAS100: ["USD"],
  USTEC: ["USD"],
  US2000: ["USD"],
  USOIL: ["USD"],
  UKOIL: ["USD"],
  WTI: ["USD"],
  BRENT: ["USD"],
  DXY: ["USD"],
  GER40: ["EUR"],
  GER30: ["EUR"],
  DE40: ["EUR"],
  EU50: ["EUR"],
  FRA40: ["EUR"],
  UK100: ["GBP"],
  JP225: ["JPY"],
  JPN225: ["JPY"],
  AUS200: ["AUD"],
  SWI20: ["CHF"],
};

function normalise(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function asCurrency(code: string): string {
  return METALS[code] ?? code;
}

function unique(codes: readonly string[]): string[] {
  return [...new Set(codes)];
}

/** The longest instrument key the symbol starts with. */
function fromInstruments(symbol: string, instruments: Readonly<Record<string, readonly string[]>>): string[] | null {
  const keys = Object.keys(instruments)
    .filter((key) => symbol.startsWith(normalise(key)) && normalise(key) !== "")
    .sort((a, b) => normalise(b).length - normalise(a).length);
  const best = keys[0];
  return best === undefined ? null : unique((instruments[best] ?? []).map((code) => code.toUpperCase()));
}

/** A pair's two halves (EURUSD), or its quote alone when only that is a currency (BTCUSD). */
function fromPair(symbol: string): string[] {
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3, 6);
  const known = (code: string) => CURRENCIES.has(code) || Object.hasOwn(METALS, code);
  if (!/^[A-Z]{6}/.test(symbol) || !known(quote)) return [];
  return unique((known(base) ? [base, quote] : [quote]).map(asCurrency));
}

/**
 * The currencies whose news moves an instrument: base and quote for a pair
 * (`EURUSD` is EUR and USD), USD for metals (`XAUUSD` is USD), and the
 * `instruments` map (over DEFAULT_INSTRUMENTS) for everything else. Broker
 * suffixes and separators are ignored: `EUR/USD`, `EURUSD.raw`, `eurusdm`.
 * An empty array means the instrument is unknown.
 *
 * @example instrumentCurrencies("XAUUSD")            // ["USD"]
 * @example instrumentCurrencies("GBPJPY.pro")        // ["GBP", "JPY"]
 * @example instrumentCurrencies("US30.cash")         // ["USD"]
 */
export function instrumentCurrencies(
  symbol: string,
  instruments: Readonly<Record<string, readonly string[]>> = {},
): string[] {
  const key = normalise(symbol);
  return fromInstruments(key, { ...DEFAULT_INSTRUMENTS, ...instruments }) ?? fromPair(key);
}

/** A news event with its time read and its currency checked. */
export interface ResolvedNews {
  bank: string;
  name: string;
  currency: string;
  time: number;
}

function newsEvent(value: unknown, index: number): ResolvedNews {
  const label = `newsEvents[${index}]`;
  if (!isRecord(value)) throw new InvalidInputError(`${label} must be an object`);
  const { bank, currency, name } = value;
  if (typeof bank !== "string" || bank === "") {
    throw new InvalidInputError(`${label}.bank must be a non-empty string, got ${describe(bank)}`);
  }
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
    throw new InvalidInputError(`${label}.currency must be a three-letter code, got ${describe(currency)}`);
  }
  if (name !== undefined && typeof name !== "string") {
    throw new InvalidInputError(`${label}.name must be a string, got ${describe(name)}`);
  }
  return { bank, name: name ?? bank, currency: currency.toUpperCase(), time: toMillis(value.t, `${label}.t`) };
}

/** Validates news events and sorts them by time. */
export function resolveNews(events: unknown): ResolvedNews[] {
  if (events === undefined || events === null) return [];
  if (!Array.isArray(events)) throw new InvalidInputError("newsEvents must be an array");
  return events.map(newsEvent).sort((a, b) => a.time - b.time);
}

export interface WindowMinutes {
  minutesBefore: number;
  minutesAfter: number;
}

export function windowStart(news: ResolvedNews, minutes: WindowMinutes): number {
  return news.time - minutes.minutesBefore * MINUTE_MS;
}

export function windowEnd(news: ResolvedNews, minutes: WindowMinutes): number {
  return news.time + minutes.minutesAfter * MINUTE_MS;
}

/** Strictly inside the window: a trade exactly at either edge is allowed. */
export function isInWindow(time: number, news: ResolvedNews, minutes: WindowMinutes): boolean {
  return time > windowStart(news, minutes) && time < windowEnd(news, minutes);
}

export function newsWindow(news: ResolvedNews, minutes: WindowMinutes): NewsWindow {
  return {
    bank: news.bank,
    name: news.name,
    currency: news.currency,
    time: toIso(news.time),
    start: toIso(windowStart(news, minutes)),
    end: toIso(windowEnd(news, minutes)),
  };
}

/**
 * The windows around news events, for showing a calendar of blackout times:
 * `minutesBefore` before each event to `minutesAfter` after it (defaults to minutesBefore).
 *
 * @example newsWindows([{ bank: "fed", currency: "USD", t: "2026-12-09T19:00:00Z" }], 2)
 * // [{ bank: "fed", name: "fed", currency: "USD", time: "2026-12-09T19:00:00.000Z",
 * //    start: "2026-12-09T18:58:00.000Z", end: "2026-12-09T19:02:00.000Z" }]
 */
export function newsWindows(
  events: readonly NewsEvent[],
  minutesBefore: number,
  minutesAfter: number = minutesBefore,
): NewsWindow[] {
  const minutes = {
    minutesBefore: windowMinutes(minutesBefore, "minutesBefore"),
    minutesAfter: windowMinutes(minutesAfter, "minutesAfter"),
  };
  return resolveNews(events).map((news) => newsWindow(news, minutes));
}

/** Minutes for a window side: 0 or more. */
export function windowMinutes(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  throw new InvalidInputError(`${label} must be 0 or more minutes, got ${describe(value)}`);
}
