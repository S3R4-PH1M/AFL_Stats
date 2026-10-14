/**
 * Thin helpers over `@duckdb/node-api` (decision D3). The database is a build artifact, rebuilt
 * from scratch by `db:build`, so there is no migration or upsert logic.
 */
import { DuckDBConnection, DuckDBInstance, type DuckDBValue } from '@duckdb/node-api';

export type { DuckDBConnection, DuckDBValue };

export interface Db {
  instance: DuckDBInstance;
  conn: DuckDBConnection;
}

export type Row = Record<string, unknown>;

/** Opens (or creates) a database; `:memory:` for tests. Session time zone is UTC. */
export async function openDb(path: string, options: { readOnly?: boolean } = {}): Promise<Db> {
  const instance = await DuckDBInstance.create(
    path,
    options.readOnly ? { access_mode: 'READ_ONLY' } : {},
  );
  const conn = await DuckDBConnection.create(instance);
  await conn.run("SET TimeZone = 'UTC'");
  return { instance, conn };
}

export function closeDb({ instance, conn }: Db): void {
  conn.closeSync();
  instance.closeSync();
}

/** Runs one or more statements. */
export async function exec(conn: DuckDBConnection, sql: string): Promise<void> {
  await conn.run(sql);
}

/** Rows as plain JS objects (DATE/TIMESTAMPTZ → Date, DECIMAL → number, BIGINT → bigint). */
export async function queryRows(
  conn: DuckDBConnection,
  sql: string,
  params?: DuckDBValue[],
): Promise<Row[]> {
  const reader = await conn.runAndReadAll(sql, params);
  return reader.getRowObjectsJS() as Row[];
}

const ROWS_PER_INSERT = 500;

/**
 * Inserts rows with chunked, parameterised multi-row `INSERT`s. DuckDB casts the bound values to
 * the column types (ISO strings → TIMESTAMPTZ / DATE, numbers → SMALLINT / DECIMAL).
 */
export async function insertRows(
  conn: DuckDBConnection,
  table: string,
  columns: readonly string[],
  rows: readonly DuckDBValue[][],
): Promise<void> {
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    const chunk = rows.slice(start, start + ROWS_PER_INSERT);
    const values: DuckDBValue[] = [];
    const tuples = chunk.map((row) => {
      if (row.length !== columns.length) {
        throw new Error(`${table}: row has ${row.length} values for ${columns.length} columns`);
      }
      const marks = row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${marks.join(', ')})`;
    });
    await conn.run(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`,
      values,
    );
  }
}
