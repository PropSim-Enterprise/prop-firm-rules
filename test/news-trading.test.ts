import { describe, expect, it } from "vitest";
import {
  type ChallengeInput,
  evaluateChallenge,
  instrumentCurrencies,
  InvalidInputError,
  newsWindows,
  parseRules,
  type Trade,
} from "../src/index.js";
import { ECB, FED, maxLoss, newsRule, START, snap, target, trade } from "./fixtures.js";

/** A history in which every trade closes flat: only the news rule can break. */
function withTrades(trades: Trade[], rules = [newsRule(2)], newsEvents = [FED, ECB]): ChallengeInput {
  return { startingBalance: START, rules, snapshots: [snap("2026-12-01T10:00:00Z", START)], trades, newsEvents };
}

describe("NEWS_TRADING", () => {
  it("fails when a trade is opened inside the window before a decision of one of its currencies", () => {
    const result = evaluateChallenge(
      withTrades([trade("2026-12-09T18:58:30Z", "2026-12-09T20:00:00Z", 0, "EURUSD")]),
    );

    expect(result.status).toBe("failed");
    expect(result.endedAt).toBe("2026-12-09T18:58:30.000Z");
    expect(result.breaches).toEqual([
      {
        code: "NEWS_TRADING",
        time: "2026-12-09T18:58:30.000Z",
        day: "2026-12-09",
        limit: 2,
        value: 1.5,
        message:
          "EURUSD trade opened 1.5 minutes before the Federal Reserve announcement (USD) at " +
          "2026-12-09T19:00:00.000Z; trades must keep 2 minutes before it",
        trade: 0,
        news: {
          bank: "fed",
          name: "Federal Reserve",
          currency: "USD",
          time: "2026-12-09T19:00:00.000Z",
          start: "2026-12-09T18:58:00.000Z",
          end: "2026-12-09T19:02:00.000Z",
        },
      },
    ]);
  });

  it("fails when a trade is closed inside the window after the decision", () => {
    const result = evaluateChallenge(
      withTrades([trade("2026-12-17T09:00:00Z", "2026-12-17T13:16:00Z", 0, "EURGBP")], [newsRule(2, 5)]),
    );

    expect(result.status).toBe("failed");
    expect(result.breaches[0]).toMatchObject({
      code: "NEWS_TRADING",
      limit: 5,
      value: 1,
      message: expect.stringContaining("EURGBP trade closed 1 minute after the European Central Bank announcement"),
    });
  });

  it("allows a trade held through the news, opened and closed outside the window", () => {
    const result = evaluateChallenge(
      withTrades([trade("2026-12-09T18:00:00Z", "2026-12-09T20:00:00Z", 0, "EURUSD")]),
    );

    expect(result.status).toBe("in_progress");
    expect(result.progress[0]).toMatchObject({ checked: 2, unchecked: 0 });
  });

  it("allows a trade exactly at the edge of the window", () => {
    const result = evaluateChallenge(
      withTrades([
        trade("2026-12-09T18:58:00Z", "2026-12-09T18:58:00Z", 0, "EURUSD"),
        trade("2026-12-09T19:02:00Z", "2026-12-09T19:30:00Z", 0, "EURUSD"),
      ]),
    );

    expect(result.status).toBe("in_progress");
  });

  it("only checks the news of the instrument's currencies", () => {
    const result = evaluateChallenge(
      withTrades([
        trade("2026-12-09T19:00:00Z", "2026-12-09T19:30:00Z", 0, "EURGBP"), // no USD in EURGBP
        trade("2026-12-17T13:15:00Z", "2026-12-17T14:00:00Z", 0, "USDJPY"), // no EUR in USDJPY
      ]),
    );

    expect(result.status).toBe("in_progress");
  });

  it("reads gold and silver as dollar instruments", () => {
    expect(instrumentCurrencies("XAUUSD")).toEqual(["USD"]);
    expect(instrumentCurrencies("XAGEUR")).toEqual(["USD", "EUR"]);

    const result = evaluateChallenge(withTrades([trade("2026-12-09T19:01:00Z", null, undefined, "XAUUSD.pro")]));
    expect(result.status).toBe("failed");
    expect(result.breaches[0]?.message).toContain("XAUUSD.pro trade opened 1 minute after the Federal Reserve");
  });

  it("reads broker symbols, indices and the instruments param", () => {
    expect(instrumentCurrencies("EUR/USD")).toEqual(["EUR", "USD"]);
    expect(instrumentCurrencies("gbpjpym")).toEqual(["GBP", "JPY"]);
    expect(instrumentCurrencies("US30.cash")).toEqual(["USD"]);
    expect(instrumentCurrencies("GER40")).toEqual(["EUR"]);
    expect(instrumentCurrencies("BTCUSD")).toEqual(["USD"]);
    expect(instrumentCurrencies("COCOA")).toEqual([]);
    expect(instrumentCurrencies("COCOA", { COCOA: ["usd", "gbp"] })).toEqual(["USD", "GBP"]);
    expect(instrumentCurrencies("US30", { US30: [] })).toEqual([]);
  });

  it("uses the instruments param in the rule", () => {
    const rules = [{ code: "NEWS_TRADING", params: { minutesBefore: 2, instruments: { COCOA: ["USD"] } } }] as const;
    const trades = [trade("2026-12-09T19:00:30Z", null, undefined, "COCOA")];

    expect(evaluateChallenge(withTrades(trades)).status).toBe("in_progress");
    expect(evaluateChallenge(withTrades(trades, parseRules(rules))).status).toBe("failed");
  });

  it("reports trades it could not check", () => {
    const result = evaluateChallenge(
      withTrades([
        trade("2026-12-09T19:00:00Z", "2026-12-09T19:00:30Z", 0),
        trade("2026-12-09T19:00:00Z", "2026-12-09T19:00:30Z", 0, "COCOA"),
      ]),
    );

    expect(result.status).toBe("in_progress");
    expect(result.progress[0]).toMatchObject({ checked: 0, unchecked: 4, uncheckedSymbols: ["COCOA"] });
  });

  it("shows the next window as of the last event", () => {
    const result = evaluateChallenge(withTrades([trade("2026-12-10T10:00:00Z", null, undefined, "EURUSD")]));

    expect(result.progress[0]).toEqual({
      code: "NEWS_TRADING",
      minutesBefore: 2,
      minutesAfter: 2,
      events: 2,
      checked: 1,
      unchecked: 0,
      uncheckedSymbols: [],
      nextWindow: {
        bank: "ecb",
        name: "European Central Bank",
        currency: "EUR",
        time: "2026-12-17T13:15:00.000Z",
        start: "2026-12-17T13:13:00.000Z",
        end: "2026-12-17T13:17:00.000Z",
      },
    });
  });

  it("lists news breaches with others broken at the same moment, in rule order", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8), maxLoss(10), newsRule(2)],
      trades: [trade("2026-12-09T18:00:00Z", "2026-12-09T19:00:00Z", -11_000, "EURUSD")],
      snapshots: [snap("2026-12-09T19:00:00Z", 89_000)],
      newsEvents: [FED],
    });

    expect(result.status).toBe("failed");
    expect(result.breaches.map((breach) => breach.code)).toEqual(["MAX_OVERALL_LOSS", "NEWS_TRADING"]);
    expect(result.breaches[0]).not.toHaveProperty("trade");
  });

  it("does not pass a challenge on a trade that breaks the news rule", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [target(8), newsRule(2)],
      trades: [trade("2026-12-09T18:00:00Z", "2026-12-09T19:01:00Z", 8_000, "USDCAD")],
      snapshots: [snap("2026-12-09T19:01:00Z", 108_000)],
      newsEvents: [FED],
    });

    expect(result.status).toBe("failed");
  });

  it("validates the rule and the news", () => {
    expect(parseRules([{ code: "NEWS_TRADING", params: { minutesBefore: 2 } }])).toEqual([
      { code: "NEWS_TRADING", params: { minutesBefore: 2, minutesAfter: 2, instruments: {} } },
    ]);
    expect(() => parseRules([{ code: "NEWS_TRADING", params: { minutesBefore: -1 } }])).toThrow(
      "NEWS_TRADING.minutesBefore must be 0 or more minutes, got -1",
    );
    expect(() => parseRules([{ code: "NEWS_TRADING", params: { minutesBefore: 2, instruments: { US30: "USD" } } }])).toThrow(
      "NEWS_TRADING.instruments.US30 must be an array of three-letter currency codes",
    );
    expect(() => evaluateChallenge({ ...withTrades([]), newsEvents: undefined })).toThrow(
      "NEWS_TRADING needs newsEvents",
    );
    expect(() => evaluateChallenge(withTrades([], [newsRule(2)], [{ bank: "fed", currency: "dollar", t: "x" }]))).toThrow(
      InvalidInputError,
    );
    expect(() => evaluateChallenge(withTrades([{ openTime: "2026-12-09T19:00:00Z", symbol: 7 } as never]))).toThrow(
      "trades[0].symbol must be a string, got 7",
    );
  });

  it("newsWindows lists the windows for a calendar", () => {
    expect(newsWindows([ECB, FED], 2, 5).map((window) => [window.bank, window.start, window.end])).toEqual([
      ["fed", "2026-12-09T18:58:00.000Z", "2026-12-09T19:05:00.000Z"],
      ["ecb", "2026-12-17T13:13:00.000Z", "2026-12-17T13:20:00.000Z"],
    ]);
  });
});
