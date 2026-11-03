/**
 * News events from InterestRateDecision.com's open data (free to reuse with a
 * link to https://interestratedecision.com). Pure: pass in what you fetched.
 * fetchIRDNewsWindows, in "prop-firm-rules/ird", does the fetching.
 */
import { InvalidInputError } from "./errors.js";
import { toIso, toMillis } from "./time.js";
import type { NewsEvent } from "./types.js";
import { isRecord } from "./validate.js";

/** The currency each central bank on InterestRateDecision.com sets the rate for. */
export const BANK_CURRENCIES: Readonly<Record<string, string>> = {
  fed: "USD",
  ecb: "EUR",
  boe: "GBP",
  boj: "JPY",
  boc: "CAD",
  rba: "AUD",
  rbnz: "NZD",
  snb: "CHF",
  norges: "NOK",
  riksbank: "SEK",
};

export interface IRDNewsOptions {
  /** Only these banks (`["fed", "ecb"]`). Defaults to every bank in the data. */
  banks?: readonly string[];
  /** Bank to currency, merged over BANK_CURRENCIES. A bank with no currency is skipped. */
  currencies?: Readonly<Record<string, string>>;
  /** Only decisions at or after this time. */
  from?: string | number | Date;
  /** Only decisions at or before this time. */
  to?: string | number | Date;
}

/** A decision as read from the data, before its currency is known. */
interface DecisionRow {
  bank: string;
  name: string;
  t: string;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new InvalidInputError("nextJson is not valid JSON");
  }
}

/** The decisions of next.json: upcoming (`decisions`) and just announced (`justDecided`). */
function fromNext(nextJson: unknown): DecisionRow[] {
  if (nextJson === undefined || nextJson === null) return [];
  const data = parseJson(nextJson);
  if (!isRecord(data) || !Array.isArray(data.decisions)) {
    throw new InvalidInputError("nextJson must be InterestRateDecision.com's /data/next.json, with a decisions array");
  }
  const rows = [...data.decisions, ...(Array.isArray(data.justDecided) ? data.justDecided : [])];
  return rows.flatMap((row): DecisionRow[] => {
    if (!isRecord(row) || typeof row.bank !== "string" || typeof row.t !== "string") return [];
    return [{ bank: row.bank, name: typeof row.name === "string" ? row.name : row.bank, t: row.t }];
  });
}

/** One CSV line, with quoted fields ("a, b") read whole. */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      fields.push(field);
      field = "";
    } else field += char;
  }
  fields.push(field);
  return fields;
}

/** The decisions of decisions.csv (bank, bank_name, time_utc, ...): every decision since 2008. */
function fromCsv(csv: string | undefined): DecisionRow[] {
  if (csv === undefined || csv.trim() === "") return [];
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const columns = csvFields(header ?? "");
  const bankAt = columns.indexOf("bank");
  const nameAt = columns.indexOf("bank_name");
  const timeAt = columns.indexOf("time_utc");
  if (bankAt < 0 || timeAt < 0) {
    throw new InvalidInputError(
      "decisionsCsv must be InterestRateDecision.com's /data/decisions.csv, with bank and time_utc columns",
    );
  }
  return lines.flatMap((line): DecisionRow[] => {
    const fields = csvFields(line);
    const bank = fields[bankAt];
    const t = fields[timeAt];
    if (!bank || !t) return [];
    return [{ bank, name: fields[nameAt] || bank, t }];
  });
}

/**
 * Converts InterestRateDecision.com's open data into news events for the
 * NEWS_TRADING rule: one per central bank decision, in the bank's currency
 * (BANK_CURRENCIES), sorted by time, without duplicates.
 *
 * - `nextJson`: https://interestratedecision.com/data/next.json (the object or its text): the decisions to come.
 * - `decisionsCsv` (optional): https://interestratedecision.com/data/decisions.csv: every past decision,
 *   to check trades already made.
 *
 * @example newsWindowsFromIRD(await (await fetch("https://interestratedecision.com/data/next.json")).json())
 * // [{ bank: "rba", currency: "AUD", t: "2026-11-03T03:30:00.000Z", name: "Reserve Bank of Australia" }, ...]
 */
export function newsWindowsFromIRD(
  nextJson: unknown,
  decisionsCsv?: string,
  options: IRDNewsOptions = {},
): NewsEvent[] {
  const currencies = { ...BANK_CURRENCIES, ...options.currencies };
  const from = options.from === undefined ? Number.NEGATIVE_INFINITY : toMillis(options.from, "from");
  const to = options.to === undefined ? Number.POSITIVE_INFINITY : toMillis(options.to, "to");
  const seen = new Set<string>();
  const events: NewsEvent[] = [];
  for (const row of [...fromCsv(decisionsCsv), ...fromNext(nextJson)]) {
    const currency = currencies[row.bank];
    if (currency === undefined || (options.banks && !options.banks.includes(row.bank))) continue;
    const time = toMillis(row.t, `decision time of ${row.bank}`);
    const key = `${row.bank} ${time}`;
    if (time < from || time > to || seen.has(key)) continue;
    seen.add(key);
    events.push({ bank: row.bank, currency, t: toIso(time), name: row.name });
  }
  return events.sort((a, b) => toMillis(a.t) - toMillis(b.t));
}
