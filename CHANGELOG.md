# Changelog

## 0.2.0 (unreleased)

- **News rule.** `NEWS_TRADING` (`minutesBefore`, `minutesAfter?`, `instruments?`) fails a challenge when a trade is opened or closed inside the window around a news event in one of the instrument's currencies. The news comes in as data: the new `newsEvents` input, `{ bank, currency, t, name? }`.
- Trades take an optional `symbol`. `instrumentCurrencies(symbol)` reads a pair's base and quote, gold and silver as USD, and common indices and oil from `DEFAULT_INSTRUMENTS`; the rule's `instruments` param adds or overrides symbols.
- `NEWS_TRADING` breaches also give the `trade` (its index in `trades`) and the `news` window. Its progress counts the trade events checked and not checked, lists the symbols it could not read and gives the next window.
- `newsWindowsFromIRD(nextJson, decisionsCsv?, options?)` turns InterestRateDecision.com's open data (`/data/next.json`, `/data/decisions.csv`) into news events, one per central bank decision, with `BANK_CURRENCIES`. Pure.
- `fetchIRDNewsWindows(options?)`, from the new `prop-firm-rules/ird` entry, fetches that data. It is the only code in the package that uses the network.
- `newsWindows(events, minutesBefore, minutesAfter?)` lists the windows, for a calendar of no-trading times.

## 0.1.0

- First release: `PROFIT_TARGET`, `MAX_DAILY_LOSS`, `MAX_OVERALL_LOSS`, `TRAILING_DRAWDOWN`, `MIN_TRADING_DAYS`, `MAX_TRADING_DAYS` and `CONSISTENCY`, `evaluateChallenge`, `parseRules` and the helpers.
