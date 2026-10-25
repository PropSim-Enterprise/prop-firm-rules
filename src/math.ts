/** `percent` percent of `amount`. Percents are percents: 5 means 5%. */
export function percentOf(amount: number, percent: number): number {
  return (amount * percent) / 100;
}

/** A billionth of the compared level: absorbs floating point noise, nothing a trader could notice. */
function tolerance(level: number): number {
  return 1e-9 * Math.max(1, Math.abs(level));
}

/** Strictly below `floor`. Equity exactly at a floor is not a breach. */
export function isBelow(value: number, floor: number): boolean {
  return value < floor - tolerance(floor);
}

export function isAtLeast(value: number, target: number): boolean {
  return value >= target - tolerance(target);
}

export function isAtMost(value: number, limit: number): boolean {
  return value <= limit + tolerance(limit);
}

/** Rounds away floating point noise (97849.99999999999 becomes 97850). */
export function tidy(value: number): number {
  const scaled = value * 1e8;
  if (!Number.isFinite(scaled) || Math.abs(scaled) >= Number.MAX_SAFE_INTEGER) return value;
  return Math.round(scaled) / 1e8 + 0;
}
