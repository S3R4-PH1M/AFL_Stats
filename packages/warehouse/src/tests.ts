/**
 * SQL data tests (proposal §12, task 9.8). Each test is a query that must return 0 rows:
 * - `sql/tests/*.sql`, in filename order. A first line `-- requires: <SQL returning a boolean>`
 *   skips the test when the condition is false (e.g. no fully loaded season).
 * - The generated tests from `sqlgen.ts`.
 */
import { readdir, readFile } from 'node:fs/promises';
import { type DuckDBConnection, queryRows, type Row } from './db.ts';
import { generatedTests, statColumns } from './sqlgen.ts';

export const TESTS_DIR = new URL('../sql/tests/', import.meta.url);
export const SAMPLE_ROWS = 10;

export interface SqlTest {
  name: string;
  description: string;
  sql: string;
  requires?: string | undefined;
}

export interface SqlTestResult {
  name: string;
  description: string;
  status: 'pass' | 'fail' | 'skip';
  failing: number;
  /** Up to `SAMPLE_ROWS` failing rows. */
  sample: Row[];
}

const REQUIRES = /^--\s*requires:\s*(.+)$/;

export async function loadSqlTests(conn: DuckDBConnection): Promise<SqlTest[]> {
  const files = (await readdir(TESTS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const fromFiles = await Promise.all(
    files.map(async (file) => {
      const text = (await readFile(new URL(file, TESTS_DIR), 'utf8')).trim();
      const lines = text.split(/\r?\n/);
      const requires = REQUIRES.exec(lines[0] ?? '')?.[1];
      const description = lines
        .filter((l) => l.startsWith('--') && !REQUIRES.test(l))
        .map((l) => l.replace(/^--\s?/, ''))
        .join(' ');
      return {
        name: file.replace(/\.sql$/, ''),
        description,
        sql: text.replace(/;\s*$/, ''),
        requires,
      };
    }),
  );
  return [...fromFiles, ...generatedTests(await statColumns(conn))];
}

export async function runSqlTest(conn: DuckDBConnection, test: SqlTest): Promise<SqlTestResult> {
  const base = { name: test.name, description: test.description };
  if (test.requires) {
    const [row] = await queryRows(conn, `SELECT (${test.requires}) AS ok`);
    if (row?.ok !== true) return { ...base, status: 'skip', failing: 0, sample: [] };
  }
  const [counted] = await queryRows(conn, `SELECT count(*) AS n FROM (\n${test.sql}\n)`);
  const failing = Number(counted?.n ?? 0);
  const sample =
    failing > 0
      ? await queryRows(conn, `SELECT * FROM (\n${test.sql}\n) LIMIT ${SAMPLE_ROWS}`)
      : [];
  return { ...base, status: failing > 0 ? 'fail' : 'pass', failing, sample };
}

export async function runSqlTests(conn: DuckDBConnection): Promise<SqlTestResult[]> {
  const results: SqlTestResult[] = [];
  for (const test of await loadSqlTests(conn)) results.push(await runSqlTest(conn, test));
  return results;
}

/** A row as one JSON line (dates as ISO, bigints as numbers). */
function formatRow(row: Row): string {
  return JSON.stringify(row, (_, v) =>
    typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString() : v,
  );
}

/** The `db:test` report. Returns the exit code: 1 if any test failed. */
export function reportSqlTests(results: SqlTestResult[], out: (line: string) => void): number {
  for (const r of results) {
    const label = { pass: 'pass', fail: 'FAIL', skip: 'skip' }[r.status];
    const extra =
      r.status === 'fail'
        ? `  (${r.failing} row${r.failing === 1 ? '' : 's'})`
        : r.status === 'skip'
          ? '  (precondition not met)'
          : '';
    out(`  ${label}  ${r.name}${extra}`);
    if (r.status === 'fail') {
      out(`        ${r.description}`);
      for (const row of r.sample) out(`        ${formatRow(row)}`);
      if (r.failing > r.sample.length) out(`        … and ${r.failing - r.sample.length} more`);
    }
  }
  const count = (s: SqlTestResult['status']) => results.filter((r) => r.status === s).length;
  out(
    `${results.length} SQL tests: ${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped`,
  );
  return count('fail') > 0 ? 1 : 0;
}
