import { describe, expect, it } from "vitest";
import { InvalidInputError, newYorkCloseOffset, tradingDayKey } from "../src/index.js";

describe("tradingDayKey", () => {
  it("uses the UTC date by default", () => {
    expect(tradingDayKey("2026-03-02T23:59:59Z")).toBe("2026-03-02");
    expect(tradingDayKey("2026-03-03T00:00:00Z")).toBe("2026-03-03");
  });

  it("starts the day at 00:00 in the given UTC offset", () => {
    expect(tradingDayKey("2026-03-02T21:59:59Z", 120)).toBe("2026-03-02");
    expect(tradingDayKey("2026-03-02T22:00:00Z", 120)).toBe("2026-03-03");
    expect(tradingDayKey("2026-03-03T04:59:00Z", -300)).toBe("2026-03-02");
    expect(tradingDayKey("2026-03-03T05:00:00Z", -300)).toBe("2026-03-03");
  });

  it("reads times without a timezone as UTC, whatever the machine's timezone", () => {
    expect(tradingDayKey("2026-03-02T23:30:00")).toBe("2026-03-02");
    expect(tradingDayKey("2026-03-02 23:30")).toBe("2026-03-02");
    expect(tradingDayKey("2026-03-02T23:30:00+02:00")).toBe("2026-03-02");
  });

  it("accepts an offset function", () => {
    expect(tradingDayKey("2026-07-01T21:30:00Z", newYorkCloseOffset)).toBe("2026-07-02");
    expect(tradingDayKey("2026-01-15T21:30:00Z", newYorkCloseOffset)).toBe("2026-01-15");
  });

  it("rejects invalid times and offsets", () => {
    expect(() => tradingDayKey("not a date")).toThrow(InvalidInputError);
    expect(() => tradingDayKey("2026-03-02T10:00:00Z", 2_000)).toThrow("dayResetUtcOffsetMinutes");
    expect(() => tradingDayKey("2026-03-02T10:00:00Z", () => Number.NaN)).toThrow("dayResetUtcOffsetMinutes");
  });
});

describe("newYorkCloseOffset", () => {
  it("is UTC+3 during US daylight saving time and UTC+2 otherwise", () => {
    expect(newYorkCloseOffset("2026-01-15T12:00:00Z")).toBe(120);
    expect(newYorkCloseOffset("2026-07-01T12:00:00Z")).toBe(180);
  });

  it("switches at 02:00 New York time on the US change dates", () => {
    // 2026: daylight saving time runs from Sunday 8 March to Sunday 1 November.
    expect(newYorkCloseOffset("2026-03-08T06:59:59Z")).toBe(120);
    expect(newYorkCloseOffset("2026-03-08T07:00:00Z")).toBe(180);
    expect(newYorkCloseOffset("2026-11-01T05:59:59Z")).toBe(180);
    expect(newYorkCloseOffset("2026-11-01T06:00:00Z")).toBe(120);
    // 2027: 14 March to 7 November.
    expect(newYorkCloseOffset("2027-03-14T06:59:59Z")).toBe(120);
    expect(newYorkCloseOffset("2027-03-14T07:00:00Z")).toBe(180);
    expect(newYorkCloseOffset("2027-11-07T06:00:00Z")).toBe(120);
  });
});
