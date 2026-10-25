import { describe, expect, it } from "vitest";
import { type AccountSnapshot, evaluateChallenge, type TrailingSource } from "../src/index.js";
import { START, snap, trailing } from "./fixtures.js";

function run(snapshots: AccountSnapshot[], trailOn: TrailingSource = "equity", lockAtStart = false) {
  return evaluateChallenge({ startingBalance: START, rules: [trailing(6, trailOn, lockAtStart)], snapshots });
}

describe("TRAILING_DRAWDOWN", () => {
  it("trails the equity high-water mark by maxPercent of the starting balance", () => {
    const peak = [snap("2026-03-02T10:00:00Z", 100_000, 103_000), snap("2026-03-02T11:00:00Z", 100_000, 97_500)];

    const holding = run(peak);
    expect(holding.status).toBe("in_progress");
    expect(holding.progress[0]).toEqual({
      code: "TRAILING_DRAWDOWN",
      maxPercent: 6,
      trailOn: "equity",
      lockAtStart: false,
      highWaterMark: 103_000,
      floor: 97_000,
      locked: false,
      distanceToFloor: 500,
    });

    const broken = run([...peak, snap("2026-03-02T12:00:00Z", 100_000, 96_900)]);
    expect(broken.status).toBe("failed");
    expect(broken.breaches[0]).toMatchObject({ code: "TRAILING_DRAWDOWN", limit: 97_000, value: 96_900 });
    expect(broken.breaches[0]?.message).toBe(
      "Equity 96,900 fell below the trailing drawdown floor of 97,000 (high-water mark 103,000 minus 6% of the starting balance)",
    );
  });

  it("ignores floating peaks when trailing the closed balance", () => {
    const result = run(
      [snap("2026-03-02T10:00:00Z", 100_000, 103_000), snap("2026-03-02T12:00:00Z", 100_000, 96_900)],
      "balance",
    );

    expect(result.status).toBe("in_progress");
    expect(result.progress[0]).toMatchObject({ highWaterMark: 100_000, floor: 94_000 });
  });

  it("keeps rising above the starting balance without lockAtStart", () => {
    const result = run([snap("2026-03-02T10:00:00Z", 108_000), snap("2026-03-02T12:00:00Z", 108_000, 101_000)]);

    expect(result.status).toBe("failed");
    expect(result.breaches[0]).toMatchObject({ limit: 102_000, value: 101_000 });
  });

  it("stops the floor at the starting balance with lockAtStart", () => {
    const peak = [snap("2026-03-02T10:00:00Z", 108_000), snap("2026-03-02T12:00:00Z", 108_000, 101_000)];

    const locked = run(peak, "equity", true);
    expect(locked.status).toBe("in_progress");
    expect(locked.progress[0]).toMatchObject({ highWaterMark: 108_000, floor: 100_000, locked: true });

    const broken = run([...peak, snap("2026-03-02T13:00:00Z", 108_000, 99_999)], "equity", true);
    expect(broken.breaches[0]).toMatchObject({ limit: 100_000, value: 99_999 });
  });

  it("does not lock before the floor reaches the starting balance", () => {
    const result = run([snap("2026-03-02T10:00:00Z", 103_000)], "equity", true);

    expect(result.progress[0]).toMatchObject({ floor: 97_000, locked: false });
  });

  describe("end_of_day_balance", () => {
    const days = [
      snap("2026-03-02T10:00:00Z", 100_000, 104_000),
      snap("2026-03-02T20:00:00Z", 103_000), // day one closes at 103,000
      snap("2026-03-03T10:00:00Z", 103_000, 97_500),
    ];

    it("raises the floor only from a finished day's closing balance", () => {
      expect(run(days, "equity").breaches[0]).toMatchObject({ limit: 98_000 }); // 104,000 intraday peak
      expect(run(days, "end_of_day_balance").progress[0]).toMatchObject({ highWaterMark: 103_000, floor: 97_000 });
    });

    it("does not move the floor on an intraday balance peak until the day closes", () => {
      const dayTwo = [...days, snap("2026-03-03T12:00:00Z", 106_000), snap("2026-03-03T14:00:00Z", 106_000, 99_500)];

      expect(run(dayTwo, "balance").breaches[0]).toMatchObject({ limit: 100_000, value: 99_500 });

      const endOfDay = run(dayTwo, "end_of_day_balance");
      expect(endOfDay.status).toBe("in_progress");
      expect(endOfDay.progress[0]).toMatchObject({ highWaterMark: 103_000, floor: 97_000 });

      // Day two closed at 106,000, so on day three the floor is 100,000.
      const dayThree = run([...dayTwo, snap("2026-03-04T10:00:00Z", 106_000, 99_800)], "end_of_day_balance");
      expect(dayThree.breaches[0]).toMatchObject({ day: "2026-03-04", limit: 100_000, value: 99_800 });
    });
  });
});
