import { describe, expect, it } from "vitest";
import { evaluateChallenge, InvalidInputError, newsWindowsFromIRD } from "../src/index.js";
import { type FetchLike, fetchIRDNewsWindows } from "../src/ird-fetch.js";
import { newsRule, START, snap, trade } from "./fixtures.js";

/** The shape of https://interestratedecision.com/data/next.json, shortened. */
const NEXT = {
  asOf: "2026-11-03T00:39:58.210Z",
  source: "https://interestratedecision.com/about/",
  licence: "Free to reuse with a link to https://interestratedecision.com",
  decisions: [
    {
      bank: "fed",
      name: "Federal Reserve",
      short: "Fed",
      rateName: "federal funds rate",
      range: true,
      t: "2026-12-09T19:00:00.000Z",
      tentative: false,
      pressConference: "2026-12-09T19:30:00Z",
      projections: true,
      rateBefore: 4,
      path: "/fed/december-2026/",
      page: "https://interestratedecision.com/fed/december-2026/",
    },
    {
      bank: "rba",
      name: "Reserve Bank of Australia",
      short: "RBA",
      rateName: "cash rate target",
      range: false,
      t: "2026-11-03T03:30:00.000Z",
      tentative: false,
      pressConference: "2026-11-03T04:30:00Z",
      projections: false,
      rateBefore: 4.6,
      path: "/rba/november-2026/",
      page: "https://interestratedecision.com/rba/november-2026/",
    },
    { bank: "rbi", name: "Reserve Bank of India", t: "2026-12-04T04:30:00.000Z" },
  ],
  justDecided: [{ bank: "boe", name: "Bank of England", t: "2026-11-05T12:00:00.000Z" }],
};

/** The shape of https://interestratedecision.com/data/decisions.csv, shortened. */
const CSV = [
  "bank,bank_name,time_utc,date,rate,change_bp",
  "fed,Federal Reserve,2026-10-28T18:00:00.000Z,2026-10-28,4,0",
  "ecb,European Central Bank,2026-10-29T13:15:00.000Z,2026-10-29,2.5,0",
  "boe,Bank of England,2026-11-05T12:00:00.000Z,2026-11-05,3.75,0",
  "",
].join("\r\n");

describe("newsWindowsFromIRD", () => {
  it("turns next.json into news events in each bank's currency, by time", () => {
    expect(newsWindowsFromIRD(NEXT)).toEqual([
      { bank: "rba", currency: "AUD", t: "2026-11-03T03:30:00.000Z", name: "Reserve Bank of Australia" },
      { bank: "boe", currency: "GBP", t: "2026-11-05T12:00:00.000Z", name: "Bank of England" },
      { bank: "fed", currency: "USD", t: "2026-12-09T19:00:00.000Z", name: "Federal Reserve" },
    ]);
  });

  it("adds past decisions from decisions.csv without duplicates, and reads JSON text", () => {
    const events = newsWindowsFromIRD(JSON.stringify(NEXT), CSV);

    expect(events.map((event) => `${event.bank} ${event.t}`)).toEqual([
      "fed 2026-10-28T18:00:00.000Z",
      "ecb 2026-10-29T13:15:00.000Z",
      "rba 2026-11-03T03:30:00.000Z",
      "boe 2026-11-05T12:00:00.000Z",
      "fed 2026-12-09T19:00:00.000Z",
    ]);
  });

  it("filters by bank and time, and takes extra currencies", () => {
    expect(newsWindowsFromIRD(NEXT, CSV, { banks: ["fed"], from: "2026-11-01" }).map((event) => event.t)).toEqual([
      "2026-12-09T19:00:00.000Z",
    ]);
    expect(newsWindowsFromIRD(NEXT, undefined, { currencies: { rbi: "INR" } }).map((event) => event.bank)).toContain(
      "rbi",
    );
    expect(newsWindowsFromIRD(null, CSV, { to: "2026-10-28T23:59:59Z" })).toHaveLength(1);
  });

  it("feeds the NEWS_TRADING rule", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [newsRule(2)],
      snapshots: [snap("2026-10-28T10:00:00Z", START)],
      trades: [trade("2026-10-28T17:59:00Z", null, undefined, "USDJPY")],
      newsEvents: newsWindowsFromIRD(NEXT, CSV),
    });

    expect(result.status).toBe("failed");
    expect(result.breaches[0]?.message).toContain("before the Federal Reserve announcement (USD)");
  });

  it("rejects data that is not IRD's", () => {
    expect(() => newsWindowsFromIRD({ rates: [] })).toThrow(InvalidInputError);
    expect(() => newsWindowsFromIRD("{")).toThrow("nextJson is not valid JSON");
    expect(() => newsWindowsFromIRD(null, "a,b\n1,2")).toThrow("decisionsCsv must be");
  });
});

describe("fetchIRDNewsWindows", () => {
  const fake =
    (pages: Record<string, string>, seen: string[] = []): FetchLike =>
    async (url) => {
      seen.push(url);
      const body = pages[url];
      return { ok: body !== undefined, status: body === undefined ? 404 : 200, text: async () => body ?? "" };
    };

  it("fetches next.json, and decisions.csv with history", async () => {
    const seen: string[] = [];
    const pages = {
      "https://interestratedecision.com/data/next.json": JSON.stringify(NEXT),
      "https://interestratedecision.com/data/decisions.csv": CSV,
    };

    expect(await fetchIRDNewsWindows({ fetch: fake(pages, seen) })).toHaveLength(3);
    expect(await fetchIRDNewsWindows({ fetch: fake(pages, seen), history: true })).toHaveLength(5);
    expect(seen).toEqual([
      "https://interestratedecision.com/data/next.json",
      "https://interestratedecision.com/data/next.json",
      "https://interestratedecision.com/data/decisions.csv",
    ]);
  });

  it("says which address failed", async () => {
    await expect(fetchIRDNewsWindows({ fetch: fake({}), baseUrl: "https://example.test/" })).rejects.toThrow(
      "https://example.test/data/next.json answered 404",
    );
  });
});
