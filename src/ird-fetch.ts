/**
 * "prop-firm-rules/ird": fetches InterestRateDecision.com's open data and turns
 * it into news events. The only part of the package that touches the network,
 * kept out of the main entry so the engine stays pure.
 */
import { InvalidInputError } from "./errors.js";
import { type IRDNewsOptions, newsWindowsFromIRD } from "./ird.js";
import type { NewsEvent } from "./types.js";

export { BANK_CURRENCIES, type IRDNewsOptions, newsWindowsFromIRD } from "./ird.js";

/** The part of fetch this needs: the global fetch of Node 20+ and browsers fits. */
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface FetchIRDOptions extends IRDNewsOptions {
  /** Also fetch decisions.csv: every decision since 2008, for checking past trades. Defaults to false. */
  history?: boolean;
  /** Defaults to https://interestratedecision.com. */
  baseUrl?: string;
  /** Defaults to the global fetch. */
  fetch?: FetchLike;
}

export const IRD_BASE_URL = "https://interestratedecision.com";

async function get(fetcher: FetchLike, url: string): Promise<string> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`prop-firm-rules: ${url} answered ${response.status}`);
  return response.text();
}

/**
 * Fetches the decisions to come (/data/next.json) and, with `history: true`,
 * every past decision (/data/decisions.csv), and returns them as news events
 * for the NEWS_TRADING rule. The data is free to reuse with a link to
 * https://interestratedecision.com.
 *
 * @example
 * import { fetchIRDNewsWindows } from "prop-firm-rules/ird";
 * const newsEvents = await fetchIRDNewsWindows({ history: true });
 */
export async function fetchIRDNewsWindows(options: FetchIRDOptions = {}): Promise<NewsEvent[]> {
  const fetcher = options.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!fetcher) throw new InvalidInputError("fetchIRDNewsWindows needs a fetch: pass options.fetch");
  const base = (options.baseUrl ?? IRD_BASE_URL).replace(/\/+$/, "");
  const [next, csv] = await Promise.all([
    get(fetcher, `${base}/data/next.json`),
    options.history === true ? get(fetcher, `${base}/data/decisions.csv`) : Promise.resolve(undefined),
  ]);
  return newsWindowsFromIRD(next, csv, options);
}
