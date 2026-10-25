import { InvalidInputError } from "./errors.js";
import type { DayResetOffset, TimeInput } from "./types.js";
import { describe } from "./validate.js";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MAX_OFFSET_MINUTES = 1440;
/** An ISO date-time with no timezone, which JavaScript would read as local time. */
const ISO_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

function parseTime(time: unknown): number {
  if (time instanceof Date) return time.getTime();
  if (typeof time === "number") return time;
  if (typeof time !== "string") return Number.NaN;
  return Date.parse(ISO_WITHOUT_ZONE.test(time) ? `${time.replace(" ", "T")}Z` : time);
}

/** Epoch milliseconds of a time input. Throws InvalidInputError if it isn't a valid time. */
export function toMillis(time: unknown, label = "time"): number {
  const ms = parseTime(time);
  if (Number.isFinite(ms)) return ms;
  throw new InvalidInputError(`${label} is not a valid time, got ${describe(time)}`);
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function checkedOffset(minutes: unknown): number {
  const valid = typeof minutes === "number" && Number.isFinite(minutes);
  if (valid && Math.abs(minutes) < MAX_OFFSET_MINUTES) return minutes;
  throw new InvalidInputError(
    `dayResetUtcOffsetMinutes must be minutes between -1440 and 1440, got ${describe(minutes)}`,
  );
}

/** Turns a day reset setting into "offset in minutes at this instant". */
export function offsetResolver(offset: DayResetOffset | undefined): (ms: number) => number {
  if (offset === undefined) return () => 0;
  if (typeof offset === "function") return (ms) => checkedOffset(offset(new Date(ms)));
  const fixed = checkedOffset(offset);
  return () => fixed;
}

/** Days since 1970-01-01 in the server's clock: the trading day an instant belongs to. */
export function dayIndexOf(ms: number, offsetAt: (ms: number) => number): number {
  return Math.floor((ms + offsetAt(ms) * MINUTE_MS) / DAY_MS);
}

export function dayKeyOf(dayIndex: number): string {
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The trading day (YYYY-MM-DD) a time belongs to, for a day that resets at
 * 00:00 in the given UTC offset.
 *
 * @example tradingDayKey("2026-03-02T22:30:00Z", 120) // "2026-03-03": past midnight at UTC+2
 */
export function tradingDayKey(time: TimeInput, dayResetUtcOffsetMinutes: DayResetOffset = 0): string {
  const ms = toMillis(time);
  return dayKeyOf(dayIndexOf(ms, offsetResolver(dayResetUtcOffsetMinutes)));
}

/** Epoch ms of the nth Sunday of a month (month 0-11) at the given UTC hour. */
function nthSundayUtc(year: number, month: number, n: number, hourUtc: number): number {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstWeekday) % 7);
  return Date.UTC(year, month, firstSunday + (n - 1) * 7, hourUtc);
}

/**
 * The UTC offset, in minutes, of a server whose day resets at 17:00 New York
 * time (the "New York close" most MT4/MT5 brokers use): 180 (UTC+3) while US
 * daylight saving time is in effect, 120 (UTC+2) otherwise. Uses the US rules in
 * force since 2007: second Sunday of March to first Sunday of November, 02:00 local.
 *
 * @example evaluateChallenge({ ..., dayResetUtcOffsetMinutes: newYorkCloseOffset })
 */
export function newYorkCloseOffset(time: TimeInput): number {
  const ms = toMillis(time);
  const year = new Date(ms).getUTCFullYear();
  const dstStart = nthSundayUtc(year, 2, 2, 7);
  const dstEnd = nthSundayUtc(year, 10, 1, 6);
  return ms >= dstStart && ms < dstEnd ? 180 : 120;
}
