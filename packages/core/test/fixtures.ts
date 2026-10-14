import { readFileSync } from 'node:fs';

/** Reads a raw M1a fixture from `packages/ingest/test/fixtures` (tests only). */
export function readFixture(path: string): string {
  return readFileSync(new URL(`../../ingest/test/fixtures/${path}`, import.meta.url), 'latin1');
}

export function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFixture(path)) as T;
}

/** Sorted unique values of `pattern`'s first capture group. */
export function uniqueMatches(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map((m) => m[1] ?? ''))].sort();
}
