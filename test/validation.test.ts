import { describe, expect, it } from "vitest";
import { type ChallengeInput, evaluateChallenge, InvalidInputError, parseRules } from "../src/index.js";
import { START, snap } from "./fixtures.js";

describe("parseRules", () => {
  it("reads landing page template rules and fills in the defaults", () => {
    const fromTemplateConfig = [
      { code: "PROFIT_TARGET", params: { targetPercent: 10 } },
      { code: "MAX_DAILY_LOSS", params: { maxPercent: 4 } },
      { code: "TRAILING_DRAWDOWN", params: { maxPercent: 6 } },
      { code: "MIN_TRADING_DAYS", params: { minDays: 3 } },
    ];

    expect(parseRules(fromTemplateConfig)).toEqual([
      { code: "PROFIT_TARGET", params: { targetPercent: 10 } },
      { code: "MAX_DAILY_LOSS", params: { maxPercent: 4, basis: "starting_balance" } },
      { code: "TRAILING_DRAWDOWN", params: { maxPercent: 6, trailOn: "equity", lockAtStart: false } },
      { code: "MIN_TRADING_DAYS", params: { minDays: 3 } },
    ]);
  });

  it("throws on an unknown code unless told to skip it", () => {
    const rules = [
      { code: "WEEKEND_HOLDING", params: { allowed: false } },
      { code: "MAX_OVERALL_LOSS", params: { maxPercent: 10 } },
    ];

    expect(() => parseRules(rules)).toThrow('rules[0] has unknown code "WEEKEND_HOLDING"');
    expect(parseRules(rules, { ignoreUnknown: true })).toEqual([
      { code: "MAX_OVERALL_LOSS", params: { maxPercent: 10 } },
    ]);
  });

  it("names the rule and param that is wrong", () => {
    expect(() => parseRules([{ code: "MAX_DAILY_LOSS", params: { maxPercent: "5" } }])).toThrow(
      'MAX_DAILY_LOSS.maxPercent must be a finite number, got "5"',
    );
    expect(() => parseRules([{ code: "MAX_DAILY_LOSS", params: { maxPercent: 5, basis: "equity" } }])).toThrow(
      "MAX_DAILY_LOSS.basis must be one of",
    );
    expect(() => parseRules([{ code: "MIN_TRADING_DAYS", params: { minDays: 2.5 } }])).toThrow(
      "MIN_TRADING_DAYS.minDays must be a whole number of days",
    );
    expect(() => parseRules([{ code: "PROFIT_TARGET" }])).toThrow("PROFIT_TARGET.targetPercent");
    expect(() => parseRules([{ code: "TRAILING_DRAWDOWN", params: { maxPercent: 6, lockAtStart: "yes" } }])).toThrow(
      "TRAILING_DRAWDOWN.lockAtStart must be true or false",
    );
  });
});

describe("evaluateChallenge input validation", () => {
  const valid: ChallengeInput = {
    startingBalance: START,
    rules: [{ code: "MAX_OVERALL_LOSS", params: { maxPercent: 10 } }],
    snapshots: [snap("2026-03-02T10:00:00Z", 100_000)],
  };
  const withInput = (patch: Record<string, unknown>) => () => evaluateChallenge({ ...valid, ...patch } as ChallengeInput);

  it("validates rules from untyped JSON", () => {
    const rules = JSON.parse('[{ "code": "MAX_OVERALL_LOSS", "params": { "maxPercent": 0 } }]');
    expect(withInput({ rules })).toThrow("MAX_OVERALL_LOSS.maxPercent must be greater than 0, got 0");
  });

  it("requires snapshots in time order", () => {
    const snapshots = [snap("2026-03-02T10:00:00Z", 100_000), snap("2026-03-02T09:00:00Z", 100_000)];
    expect(withInput({ snapshots })).toThrow("snapshots[1] is earlier than snapshots[0]");
  });

  it("rejects bad numbers and times", () => {
    expect(withInput({ startingBalance: 0 })).toThrow(InvalidInputError);
    expect(withInput({ snapshots: [{ time: "yesterday", balance: 1, equity: 1 }] })).toThrow(
      "snapshots[0].time is not a valid time",
    );
    expect(withInput({ snapshots: [snap("2026-03-02T10:00:00Z", 100_000, Number.NaN)] })).toThrow(
      "snapshots[0].equity must be a finite number",
    );
    expect(withInput({ snapshots: null })).toThrow("snapshots must be an array");
  });

  it("rejects inconsistent trades", () => {
    expect(withInput({ trades: [{ openTime: "2026-03-02T10:00:00Z", closeTime: "2026-03-02T09:00:00Z", profit: 1 }] }))
      .toThrow("trades[0].closeTime is before its openTime");
    expect(withInput({ trades: [{ openTime: "2026-03-02T10:00:00Z", closeTime: "2026-03-02T11:00:00Z" }] })).toThrow(
      "trades[0].profit must be a finite number",
    );
  });
});
