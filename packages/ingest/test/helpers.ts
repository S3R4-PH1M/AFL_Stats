import { readFileSync } from 'node:fs';
import { decodeHtml } from '../src/afltables/decode.ts';

/** Raw bytes of an M1a fixture in `test/fixtures` (tests only). */
export function readFixtureBytes(path: string): Buffer {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url));
}

/** An AFL Tables fixture decoded the way the build will decode the raw cache. */
export function readAfltables(name: string): string {
  return decodeHtml(readFixtureBytes(`afltables/${name}`));
}

/** The five M1a match fixtures, with the season and match key encoded in each file name. */
export const MATCH_FIXTURES = [
  '2025-141820250511',
  '2025-010520250322',
  '2025-091920250927',
  '2025-121920250511',
  '2003-010320030629',
].map((name) => {
  const [season, matchKey] = name.split('-') as [string, string];
  return { name, season: Number(season), matchKey };
});
