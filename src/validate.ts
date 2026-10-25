import { InvalidInputError } from "./errors.js";

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function describe(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export function finiteNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new InvalidInputError(`${label} must be a finite number, got ${describe(value)}`);
}

export function positiveNumber(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (number > 0) return number;
  throw new InvalidInputError(`${label} must be greater than 0, got ${describe(value)}`);
}

export function percentNumber(value: unknown, label: string): number {
  const number = positiveNumber(value, label);
  if (number <= 100) return number;
  throw new InvalidInputError(`${label} must be a percent from 0 to 100, got ${describe(value)}`);
}
