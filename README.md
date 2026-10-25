# prop-firm-rules: prop firm challenge rules engine for TypeScript

[![CI](https://github.com/PropSim-Enterprise/prop-firm-rules/actions/workflows/ci.yml/badge.svg)](https://github.com/PropSim-Enterprise/prop-firm-rules/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`prop-firm-rules` evaluates prop firm challenge rules against a trading account's history: **profit target**, **max daily loss** (daily drawdown), **max overall loss**, **trailing drawdown**, **minimum and maximum trading days**, and the **consistency rule**. Give it the starting balance, the rules and time-ordered balance and equity snapshots from MetaTrader 4/5 (MT4/MT5), cTrader, a futures platform or your own simulator, and it tells you whether the funded trader evaluation is passed, failed or still in progress, which rule was breached and when, and how close the account is to every limit right now. Use it to build prop trading dashboards, drawdown and daily loss limit calculators, risk management alerts, trading journals, or to check the numbers of your own prop firm platform. Written in TypeScript, zero dependencies, runs in Node 20+ and the browser.

- [Install](#install)
- [Quick example](#quick-example)
- [How evaluation works](#how-evaluation-works)
- [The rules](#the-rules)
- [Day reset and time zones](#day-reset-and-time-zones)
- [Helpers](#helpers)
- [Rules from the landing page templates](#rules-from-the-landing-page-templates)
- [FAQ](#faq)
- [Rules vary between firms](#rules-vary-between-firms)

## Install

```sh
npm install prop-firm-rules
```

> `prop-firm-rules` is the intended npm package name for the first release.

ESM only, with TypeScript types included. No runtime dependencies.

## Quick example

A $100,000 two-step challenge, phase 1: 8% profit target, 5% max daily loss, 10% max overall loss, at least 4 trading days. The broker's server day starts at 00:00 UTC+2.

```ts
import { evaluateChallenge } from "prop-firm-rules";

const result = evaluateChallenge({
  startingBalance: 100_000,
  rules: [
    { code: "PROFIT_TARGET", params: { targetPercent: 8 } },
    { code: "MAX_DAILY_LOSS", params: { maxPercent: 5 } },
    { code: "MAX_OVERALL_LOSS", params: { maxPercent: 10 } },
    { code: "MIN_TRADING_DAYS", params: { minDays: 4 } },
  ],
  snapshots: [
    { time: "2026-03-02T09:30:00Z", balance: 100_000, equity: 99_120 },
    { time: "2026-03-02T15:45:00Z", balance: 102_340, equity: 102_340 },
    { time: "2026-03-03T10:10:00Z", balance: 102_340, equity: 98_870 },
    { time: "2026-03-03T16:20:00Z", balance: 101_610, equity: 101_610 },
    { time: "2026-03-04T14:05:00Z", balance: 105_480, equity: 105_480 },
  ],
  dayResetUtcOffsetMinutes: 120,
});
```

Output (`result`, with `metrics.days` shortened):

```js
{
  status: "in_progress",
  endedAt: null,
  breaches: [],
  progress: [
    { code: "PROFIT_TARGET", targetPercent: 8, targetBalance: 108000, targetProfit: 8000,
      profit: 5480, remaining: 2520, met: false },
    { code: "MAX_DAILY_LOSS", maxPercent: 5, basis: "starting_balance", day: "2026-03-04",
      dayStartBalance: 101610, dayStartEquity: 101610, dayStartLevel: 101610,
      allowedLoss: 5000, floor: 96610, lossToday: 0, distanceToFloor: 8870 },
    { code: "MAX_OVERALL_LOSS", maxPercent: 10, allowedLoss: 10000, floor: 90000,
      distanceToFloor: 15480 },
    { code: "MIN_TRADING_DAYS", minDays: 4, daysTraded: 3, remaining: 1, met: false },
  ],
  metrics: {
    balance: 105480, equity: 105480, profit: 5480, profitPercent: 5.48,
    highWaterMark: 105480, lowestEquity: 98870, maxDrawdown: 3470, maxDrawdownPercent: 3.47,
    tradingDays: 3,
    days: [
      { day: "2026-03-02", startBalance: 100000, startEquity: 100000, endBalance: 102340,
        endEquity: 102340, lowestEquity: 99120, highestEquity: 102340, profit: 2340, traded: true },
      // 2026-03-03 and 2026-03-04 ...
    ],
  },
}
```

Add a fourth day that closes at 108,150 and the challenge passes: target and minimum days are both met.

```js
// ...snapshots,
{ time: "2026-03-05T13:30:00Z", balance: 106_920, equity: 107_400 },
{ time: "2026-03-05T18:00:00Z", balance: 108_150, equity: 108_150 },

result.status;  // "passed"
result.endedAt; // "2026-03-05T18:00:00.000Z"
```

If instead equity had dipped to 100,310 at 13:30 on day four, the challenge fails there, even though the day closes at 106,900. Day four started at a balance of 105,480, so its floor was 105,480 − 5,000 = 100,480:

```js
// ...snapshots,
{ time: "2026-03-05T13:30:00Z", balance: 105_480, equity: 100_310 },
{ time: "2026-03-05T18:00:00Z", balance: 106_900, equity: 106_900 },

result.status;   // "failed"
result.breaches; // [{
                 //   code: "MAX_DAILY_LOSS",
                 //   time: "2026-03-05T13:30:00.000Z",
                 //   day: "2026-03-05",
                 //   limit: 100480,
                 //   value: 100310,
                 //   message: "Equity 100,310 fell below the daily loss floor of 100,480 (5% of the starting balance)",
                 // }]
```

## How evaluation works

### Input

| Field | Meaning |
|---|---|
| `startingBalance` | The account's initial balance. |
| `rules` | The rules, as `{ code, params }`. Percent params are percents: `5` means 5%. |
| `snapshots` | `{ time, balance, equity }` in time order. **balance** is the closed balance (starting balance plus realised P&L); **equity** is balance plus the floating P&L of open positions. |
| `trades` (optional) | `{ openTime, closeTime, profit }`, in any order. Leave `closeTime` out (or `null`) for a position that is still open. `profit` is net of commission and swap. Trades only decide trading days and daily profit: balance and equity always come from the snapshots. |
| `dayResetUtcOffsetMinutes` (optional) | When the trading day resets, as a UTC offset in minutes. Default `0` (00:00 UTC). See [Day reset and time zones](#day-reset-and-time-zones). |

Times can be ISO 8601 strings, `Date` objects or epoch milliseconds.

### Replay

The engine replays the history in time order, starting from a flat account at `startingBalance`:

1. Every snapshot updates balance, equity, the high-water marks and the current trading day.
2. After every snapshot, each **limit rule** is checked (`MAX_DAILY_LOSS`, `MAX_OVERALL_LOSS`, `TRAILING_DRAWDOWN`, `MAX_TRADING_DAYS`). If any is broken the challenge **fails** at that moment.
3. Otherwise, if every **objective** is met (`PROFIT_TARGET`, plus `MIN_TRADING_DAYS` and `CONSISTENCY` when present), the challenge **passes** at that moment.
4. Data after the pass or fail is ignored. If neither happens, the status is `in_progress`.

When trades are given, opening a trade can complete the minimum days and so pass the challenge (or start one day too many), so trade times are checked too. A trade and a snapshot at the same instant are checked together.

Without a `PROFIT_TARGET` rule there is nothing to pass: use that for a funded account, which stays `in_progress` until a limit breaks.

### Trading days and daily profit

- **With `trades`:** a trading day is a day on which at least one trade was **opened**. A day's profit is the profit of trades **closed** that day.
- **Without `trades`:** both come from the snapshots. A trading day is a day on which the balance changed (a trade closed), and a day's profit is the day's balance change.

Days are reset-adjusted: with `dayResetUtcOffsetMinutes: 120`, a trade at 22:30 UTC belongs to the next day.

### Result

| Field | Meaning |
|---|---|
| `status` | `"passed"`, `"failed"` or `"in_progress"`. |
| `endedAt` | When it passed or failed (ISO 8601, UTC), else `null`. |
| `breaches` | Every rule broken at the moment of failure, in rule order: `{ code, time, day, limit, value, message }`. `limit` is the equity floor (days for `MAX_TRADING_DAYS`), `value` is the equity (days traded) that broke it. |
| `progress` | One entry per rule, in rule order, as of the end: profit vs target, today's floor and loss, distance to each floor, days traded, consistency ratio. |
| `metrics` | Balance, equity, profit, high-water mark, lowest equity, max drawdown (amount and % of starting balance), trading days, and a per-day summary. |

## The rules

| Code | Params | Kind | Breach / met when |
|---|---|---|---|
| `PROFIT_TARGET` | `targetPercent` | objective | closed balance ≥ start × (1 + targetPercent / 100) |
| `MAX_DAILY_LOSS` | `maxPercent`, `basis?` | limit | equity < today's floor |
| `MAX_OVERALL_LOSS` | `maxPercent` | limit | equity < start × (1 − maxPercent / 100) |
| `TRAILING_DRAWDOWN` | `maxPercent`, `trailOn?`, `lockAtStart?` | limit | equity < high-water mark − start × maxPercent / 100 |
| `MIN_TRADING_DAYS` | `minDays` | objective | trading days ≥ minDays |
| `MAX_TRADING_DAYS` | `maxDays` | limit | trading days > maxDays before passing |
| `CONSISTENCY` | `maxDayPercent` | objective | best day ≤ maxDayPercent of total profit |

Equity exactly at a floor is allowed; a cent below is a breach. A balance exactly at the target passes.

### PROFIT_TARGET

```
targetBalance = startingBalance × (1 + targetPercent / 100)
passed when balance ≥ targetBalance (and every other objective is met)
```

Only closed profit counts. Floating profit does not: close the trades to bank it.

> $100,000 account, `targetPercent: 8`: the target balance is $108,000. A balance of $107,400 with $1,200 floating (equity $108,600) has not reached it.

### MAX_DAILY_LOSS

```
floor = dayStartLevel − allowedLoss
fails when equity < floor at any snapshot during the day
```

Firms differ on what the percent is taken of and where today's loss is measured from. Pick it with `basis`:

| `basis` | `allowedLoss` | `dayStartLevel` (loss measured from) |
|---|---|---|
| `"starting_balance"` (default) | maxPercent of the starting balance (a fixed amount) | the day-start balance |
| `"day_start_balance"` | maxPercent of the day-start balance | the day-start balance |
| `"day_start_equity_or_balance_higher"` | maxPercent of the higher of day-start balance and equity | that higher value |

The day-start balance and equity are the last known values before the reset (the starting balance on day one). Because the check uses equity, a floating loss counts, and so does floating loss carried over from yesterday. An intraday dip below the floor fails the challenge even if the day closes green.

> $100,000 account, `maxPercent: 5`. Yesterday closed with a balance of $102,000 and an open trade $2,000 in profit, so today starts at balance $102,000 and equity $104,000:
>
> - `starting_balance`: $102,000 − 5% of $100,000 = **$97,000**
> - `day_start_balance`: $102,000 − 5% of $102,000 = **$96,900**
> - `day_start_equity_or_balance_higher`: $104,000 − 5% of $104,000 = **$98,800**
>
> Equity of $97,500 is fine under the first two and a breach under the third.

### MAX_OVERALL_LOSS

```
floor = startingBalance × (1 − maxPercent / 100)
fails when equity < floor
```

A static floor: it never moves, however much the account makes.

> $100,000 account, `maxPercent: 10`: equity must stay at or above $90,000, even after the balance has grown to $110,000.

### TRAILING_DRAWDOWN

```
floor = highWaterMark − startingBalance × maxPercent / 100
with lockAtStart: floor = min(floor, startingBalance)
fails when equity < floor
```

The floor follows the account's peak up, never down. The drawdown amount is fixed (a percent of the starting balance). Options:

| Option | Values | Meaning |
|---|---|---|
| `trailOn` | `"equity"` (default) | Peak of equity, floating profit included: intraday trailing. The strictest. |
| | `"balance"` | Peak of the closed balance. |
| | `"end_of_day_balance"` | Peak of each finished trading day's closing balance: the floor only moves at the daily reset (end-of-day trailing). |
| `lockAtStart` | `false` (default) | The floor keeps trailing forever. |
| | `true` | The floor stops at the starting balance once it gets there, common in futures-style evaluations. |

Every peak starts at the starting balance. The breach check always uses equity.

> $100,000 account, `maxPercent: 6` ($6,000). Equity peaks at $103,000: the floor is $97,000. Equity peaks at $108,000: the floor is $102,000, or $100,000 with `lockAtStart`.

### MIN_TRADING_DAYS

```
passed only when tradingDays ≥ minDays (and every other objective is met)
```

Reaching the target early does not pass the challenge: it stays `in_progress` until the account has traded on enough days. With `trades`, the pass happens the moment the first trade of the last required day opens.

> `minDays: 4`, target reached on day 2: the challenge passes on day 4, the moment the account trades that day.

### MAX_TRADING_DAYS

```
fails when tradingDays > maxDays before the challenge has passed
```

The breach happens at the first trade (or balance change) on day `maxDays + 1`. Passing on the last allowed day is a pass. This counts **trading** days, not calendar days.

> `maxDays: 30`: trading on a 31st day without having passed fails the challenge.

### CONSISTENCY

```
bestDayPercent = bestDayProfit / totalProfit × 100
met when totalProfit > 0 and bestDayPercent ≤ maxDayPercent
```

`totalProfit` is the net closed profit over all days (losing days reduce it). This rule never fails a challenge: it is checked against the target at pass time, so a challenge with a too-large best day stays `in_progress` until more profit dilutes it. `progress` reports the current ratio and the total profit needed (`requiredTotalProfit = bestDayProfit × 100 / maxDayPercent`).

> `maxDayPercent: 40`, $8,000 total profit with a best day of $5,000: 62.5%, so not yet. The account needs $12,500 total profit (5,000 / 12,500 = 40%) to pass.

### When two rules break

The first breach wins: the challenge fails at the earliest moment any limit breaks, and later data is ignored. If two rules break at the same moment, `breaches` lists both, in the order of `rules`. A breach at the same moment the target is reached still fails the challenge.

## Day reset and time zones

`dayResetUtcOffsetMinutes` is the UTC offset of the clock the firm uses for its trading day. The day resets at 00:00 on that clock:

| Setting | Day resets at |
|---|---|
| `0` (default) | 00:00 UTC |
| `120` | 00:00 UTC+2 = 22:00 UTC |
| `-300` | 00:00 UTC−5 = 05:00 UTC |
| `newYorkCloseOffset` | 17:00 New York time, all year (UTC+3 in US summer time, UTC+2 otherwise) |

Most MT4/MT5 servers run on "New York close" time, which moves with US daylight saving time. Pass the function to follow it:

```ts
import { evaluateChallenge, newYorkCloseOffset } from "prop-firm-rules";

evaluateChallenge({ ...input, dayResetUtcOffsetMinutes: newYorkCloseOffset });
```

Any `(time: Date) => number` works, for other daylight saving rules.

ISO strings without a timezone (`"2026-03-02T23:30:00"`) are read as **UTC**, not the machine's local time, so results don't depend on where the code runs. MT4/MT5 reports print **server time**: convert it, or add the offset (`"2026-03-02T23:30:00+02:00"`).

## Helpers

Small pure functions for calculators and UIs. The engine uses the same functions, so numbers in your UI match the evaluation.

```ts
import {
  profitTargetAmount,
  profitTargetBalance,
  maxLossFloor,
  dailyLossLimit,
  dailyLossFloor,
  trailingDrawdownFloor,
  consistencyPercent,
  requiredProfitForConsistency,
  tradingDayKey,
  newYorkCloseOffset,
  parseRules,
} from "prop-firm-rules";

profitTargetAmount(100_000, 8);  // 8000
profitTargetBalance(100_000, 8); // 108000
maxLossFloor(100_000, 10);       // 90000

dailyLossLimit({
  startingBalance: 100_000,
  dayStartBalance: 102_000,
  dayStartEquity: 104_000,
  maxPercent: 5,
  basis: "day_start_equity_or_balance_higher",
}); // { dayStartLevel: 104000, allowedLoss: 5200, floor: 98800 }
dailyLossFloor({ startingBalance: 100_000, dayStartBalance: 102_000, dayStartEquity: 104_000, maxPercent: 5 }); // 97000

trailingDrawdownFloor({ highWaterMark: 108_000, startingBalance: 100_000, maxPercent: 6 });                    // 102000
trailingDrawdownFloor({ highWaterMark: 108_000, startingBalance: 100_000, maxPercent: 6, lockAtStart: true }); // 100000

consistencyPercent([3_000, -500, 1_500]);  // 75 (best day as % of total profit; null if total ≤ 0)
requiredProfitForConsistency(3_000, 40);   // 7500

tradingDayKey("2026-03-02T22:30:00Z", 120);              // "2026-03-03"
newYorkCloseOffset("2026-07-01T12:00:00Z");              // 180
```

| Function | Returns |
|---|---|
| `evaluateChallenge(input)` | The full evaluation: status, breaches, progress, metrics. |
| `parseRules(rules, { ignoreUnknown? })` | Typed, validated rules with defaults filled in, from loosely typed config. |
| `profitTargetAmount(start, targetPercent)` | The profit the target needs. |
| `profitTargetBalance(start, targetPercent)` | The balance that passes the target. |
| `maxLossFloor(start, maxPercent)` | The static max loss floor. |
| `dailyLossLimit(input)` | Today's `{ dayStartLevel, allowedLoss, floor }` for a basis. |
| `dailyLossFloor(input)` | Today's daily loss floor. |
| `trailingDrawdownFloor(input)` | The trailing floor for a high-water mark. |
| `consistencyPercent(dailyProfits)` | The best day as a percent of total profit, or `null`. |
| `requiredProfitForConsistency(bestDay, maxDayPercent)` | The total profit that satisfies the consistency rule. |
| `tradingDayKey(time, offset?)` | The reset-adjusted trading day, `YYYY-MM-DD`. |
| `newYorkCloseOffset(time)` | 180 or 120: the UTC offset of a New York close server. |

Invalid input throws `InvalidInputError`, with a message that names the field (`"MAX_DAILY_LOSS.maxPercent must be a finite number, got \"5\""`).

## Rules from the landing page templates

The free [prop firm landing page templates](https://github.com/PropSim-Enterprise/prop-firm-landing-page-templates) describe each challenge phase with the same rule codes and params. Validate them with `parseRules` and evaluate an account against the phase it is in:

```ts
import { evaluateChallenge, parseRules } from "prop-firm-rules";
import { PRODUCTS } from "./site/config";

const phase = PRODUCTS[0].template.phases[0]; // e.g. 10K 2-Step, PHASE_1
const result = evaluateChallenge({
  startingBalance: phase.startingBalance,
  rules: parseRules(phase.rules, { ignoreUnknown: true }),
  snapshots,
});
```

`ignoreUnknown: true` skips any rule codes this library doesn't evaluate instead of throwing.

## FAQ

### How is trailing drawdown calculated?

The floor is the account's high-water mark minus a fixed amount, `maxPercent` of the starting balance. On a $100,000 account with a 6% trailing drawdown the amount is $6,000: the floor starts at $94,000, and when equity peaks at $103,000 it moves up to $97,000. It never moves down. `trailOn` picks which peak it follows (equity, closed balance, or end-of-day balance) and `lockAtStart: true` stops it at the starting balance. See [TRAILING_DRAWDOWN](#trailing_drawdown).

### Balance vs equity daily loss: what's the difference?

Two separate questions. **What is checked** is always equity, so open losses count the moment they happen. **What the limit is based on** is the `basis`: a percent of the starting balance (a fixed dollar amount every day), of the day-start balance, or of the higher of day-start balance and equity. The last one is stricter after a day that ends with open profit, because the floating profit raises today's starting level. See the [worked example](#max_daily_loss).

### Does an intraday dip count if the day closes in profit?

Yes. If any snapshot's equity is below the day's floor, the challenge fails at that snapshot, whatever happens later. The engine can only see the snapshots you give it, so for real enforcement feed it equity at least every minute and at every trade event.

### When does the trading day reset?

At 00:00 in `dayResetUtcOffsetMinutes` (UTC by default). For MT4/MT5 servers on New York close time, pass `newYorkCloseOffset`, which handles US daylight saving time.

### What counts as a trading day?

When you pass `trades`, a day on which a trade was opened: holding a position over several days counts only the day it opened. Without trades, a day on which the balance changed, which is the day a trade closed.

### Why is the challenge still in progress after I hit the profit target?

Another objective isn't met yet: not enough trading days (`MIN_TRADING_DAYS`), or the best day is too large a share of the profit (`CONSISTENCY`). The `progress` entries say which, and how far off it is. Also check that the profit is closed: floating profit doesn't count toward the target.

### Does it support a calendar time limit, like 30 days to pass?

Not as a rule. `MAX_TRADING_DAYS` counts trading days. For a calendar deadline, compare the challenge's start date with today yourself.

### Can I use it for funded accounts?

Yes. Leave out `PROFIT_TARGET`: the account can then only fail, and `progress` shows how close it is to each limit.

### Does it run in the browser?

Yes. It has no dependencies and uses no Node APIs.

## Rules vary between firms

Every prop firm writes its rules a little differently: what the daily loss is based on, when the day resets, whether the trailing drawdown follows equity or balance and when it locks, what counts as a trading day, how consistency is measured. This library makes the common variants explicit options and documents exactly what each one does, but it is a **reference implementation, not any firm's official rule engine**. It is not affiliated with, endorsed by or connected to any prop firm. Always check results against your firm's own rulebook. If a common variant is missing, please open an issue.

## Development

```sh
npm install
npm test           # vitest
npm run typecheck  # tsc
npm run build      # tsc -> dist/ (.js + .d.ts)
```

## License

[MIT](LICENSE)

---

Built by [PropSim](https://propsim.markets/?utm_source=github&utm_medium=readme&utm_campaign=prop-firm-rules), prop firm software that enforces these rules on every tick. Starting a prop firm? Get the free [prop firm landing page templates](https://github.com/PropSim-Enterprise/prop-firm-landing-page-templates) too.
