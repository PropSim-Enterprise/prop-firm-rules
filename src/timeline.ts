import { InvalidInputError } from "./errors.js";
import { toMillis } from "./time.js";
import { describe, finiteNumber, isRecord } from "./validate.js";

export interface SnapshotEvent {
  kind: "snapshot";
  time: number;
  balance: number;
  equity: number;
}

export interface TradeOpenEvent {
  kind: "open";
  time: number;
  /** The trade's index in the input. */
  trade: number;
  symbol: string | null;
}

export interface TradeCloseEvent {
  kind: "close";
  time: number;
  profit: number;
  trade: number;
  symbol: string | null;
}

export type TimelineEvent = SnapshotEvent | TradeOpenEvent | TradeCloseEvent;

/** At the same instant, trades are applied before the snapshot that reflects them. */
const KIND_ORDER: Readonly<Record<TimelineEvent["kind"], number>> = { close: 0, open: 1, snapshot: 2 };

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (isRecord(value)) return value;
  throw new InvalidInputError(`${label} must be an object`);
}

function list(value: unknown, label: string): readonly unknown[] {
  if (Array.isArray(value)) return value;
  throw new InvalidInputError(`${label} must be an array`);
}

function toSnapshotEvent(value: unknown, index: number): SnapshotEvent {
  const label = `snapshots[${index}]`;
  const snapshot = record(value, label);
  return {
    kind: "snapshot",
    time: toMillis(snapshot.time, `${label}.time`),
    balance: finiteNumber(snapshot.balance, `${label}.balance`),
    equity: finiteNumber(snapshot.equity, `${label}.equity`),
  };
}

function snapshotEvents(snapshots: unknown): SnapshotEvent[] {
  const events = list(snapshots, "snapshots").map(toSnapshotEvent);
  events.forEach((event, i) => {
    const previous = events[i - 1];
    if (previous && event.time < previous.time) {
      throw new InvalidInputError(
        `snapshots must be in time order: snapshots[${i}] is earlier than snapshots[${i - 1}]`,
      );
    }
  });
  return events;
}

function symbolOf(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  throw new InvalidInputError(`${label} must be a string, got ${describe(value)}`);
}

function tradeEvents(value: unknown, index: number): TimelineEvent[] {
  const label = `trades[${index}]`;
  const trade = record(value, label);
  const symbol = symbolOf(trade.symbol, `${label}.symbol`);
  const openTime = toMillis(trade.openTime, `${label}.openTime`);
  const open: TradeOpenEvent = { kind: "open", time: openTime, trade: index, symbol };
  if (trade.closeTime === undefined || trade.closeTime === null) return [open];
  const closeTime = toMillis(trade.closeTime, `${label}.closeTime`);
  if (closeTime < open.time) throw new InvalidInputError(`${label}.closeTime is before its openTime`);
  const profit = finiteNumber(trade.profit, `${label}.profit`);
  return [open, { kind: "close", time: closeTime, profit, trade: index, symbol }];
}

/** Every snapshot and trade event in time order. Trades may come in any order. */
export function buildTimeline(snapshots: unknown, trades: unknown): TimelineEvent[] {
  const fromTrades = trades === undefined || trades === null ? [] : list(trades, "trades").flatMap(tradeEvents);
  const events: TimelineEvent[] = [...snapshotEvents(snapshots), ...fromTrades];
  return events.sort((a, b) => a.time - b.time || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}
