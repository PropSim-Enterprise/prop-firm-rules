import { describe, expect, it } from "vitest";
import { evaluateChallenge } from "../src/index.js";
import { maxLoss, START, snap } from "./fixtures.js";

describe("MAX_OVERALL_LOSS", () => {
  it("keeps a static floor that does not rise with profits", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [maxLoss(10)],
      snapshots: [snap("2026-03-02T20:00:00Z", 110_000), snap("2026-03-03T10:00:00Z", 110_000, 91_000)],
    });

    expect(result.status).toBe("in_progress");
    expect(result.progress[0]).toEqual({
      code: "MAX_OVERALL_LOSS",
      maxPercent: 10,
      allowedLoss: 10_000,
      floor: 90_000,
      distanceToFloor: 1_000,
    });
  });

  it("fails when equity drops below the floor", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [maxLoss(10)],
      snapshots: [snap("2026-03-02T10:00:00Z", 95_000), snap("2026-03-03T10:00:00Z", 95_000, 89_999)],
    });

    expect(result.status).toBe("failed");
    expect(result.breaches).toEqual([
      {
        code: "MAX_OVERALL_LOSS",
        time: "2026-03-03T10:00:00.000Z",
        day: "2026-03-03",
        limit: 90_000,
        value: 89_999,
        message: "Equity 89,999 fell below the maximum loss floor of 90,000 (10% of the starting balance)",
      },
    ]);
  });

  it("allows equity exactly at the floor", () => {
    const result = evaluateChallenge({
      startingBalance: START,
      rules: [maxLoss(10)],
      snapshots: [snap("2026-03-02T10:00:00Z", 90_000)],
    });

    expect(result.status).toBe("in_progress");
  });
});
