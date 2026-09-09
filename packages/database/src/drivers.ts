/**
 * Driver plumbing shared by GameDatabase and DatabaseDriver: identifying the
 * raw client behind a drizzle instance, the three operations we perform on it
 * directly, and loading the optional driver packages.
 */

/**
 * The driver behind a drizzle instance, named by the raw SQL surface it
 * exposes. One SQL flavor can arrive through more than one of these:
 * `node-postgres` and `postgres-js` are both plain `pg`.
 */
export type SubDialect = 'sqlite' | 'postgres-js' | 'pglite' | 'node-postgres';

/**
 * What we ask of a raw client, below the drizzle query builder. Everything
 * else in the package goes through drizzle and is driver-portable as-is.
 *
 * The SQL passed here is dialect-flavored (`$1` vs `?`, `information_schema`
 * vs `pragma_table_info`) and chosen by the caller. These functions only
 * carry it to the right method.
 */
interface RawDriver {
  /** Run one statement, discarding any result. */
  exec(client: any, sql: string): Promise<void> | void;
  /** Run one parameterized query and return its rows. */
  rows(client: any, sql: string, params: unknown[]): Promise<any[]> | any[];
  /** Close the connection. node:sqlite's is sync; awaiting it is harmless. */
  close(client: any): Promise<void> | void;
}

export const RAW_DRIVERS: Record<SubDialect, RawDriver> = {
  'postgres-js': {
    exec: (c, sql) => c.unsafe(sql),
    rows: (c, sql, params) => c.unsafe(sql, params),
    close: (c) => c.end(),
  },
  'node-postgres': {
    exec: (c, sql) => c.query(sql),
    rows: async (c, sql, params) => (await c.query(sql, params)).rows,
    close: (c) => c.end(),
  },
  'pglite': {
    exec: (c, sql) => c.exec(sql),
    rows: async (c, sql, params) => (await c.query(sql, params)).rows,
    close: (c) => c.close(),
  },
  'sqlite': {
    exec: (c, sql) => c.exec(sql),
    rows: (c, sql, params) => c.prepare(sql).all(...params),
    close: (c) => c.close(),
  },
};

/**
 * Identify a raw client by the methods it exposes. `null` means the client is
 * absent, or offers no raw SQL entry point (an HTTP-proxy driver, say).
 *
 * Order matters: pglite answers to both `exec` and `query`, sqlite to both
 * `exec` and `prepare`, so the narrower signatures are tested first.
 */
export function probeRawClient(client: any): SubDialect | null {
  if (!client) { return null; }
  if (typeof client.unsafe === 'function') { return 'postgres-js'; }
  if (typeof client.prepare === 'function' && typeof client.exec === 'function') { return 'sqlite'; }
  if (typeof client.exec === 'function' && typeof client.query === 'function') { return 'pglite'; }
  if (typeof client.query === 'function') { return 'node-postgres'; }
  return null;
}

/** The raw client a drizzle instance was built on, or null if it exposes none. */
export function rawClientOf(drizzle: any): any {
  return drizzle?.$client ?? null;
}

/** True when `error` is Node reporting that `pkg` itself is not installed. */
function isMissingPackage(error: any, pkg: string): boolean {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'MODULE_NOT_FOUND') { return false; }
  // Both loaders quote the specifier: "Cannot find package 'postgres' imported
  // from …" (ESM) / "Cannot find module 'postgres'" (CJS). Matching the quoted
  // name keeps a missing transitive dependency inside the driver from being
  // reported as the driver being absent.
  return String(error.message).includes(`'${pkg}'`);
}

/**
 * Import an optional driver package, translating "not installed" into an
 * actionable message. Any other failure propagates untouched.
 *
 * `hint` completes the sentence "<hint>:", so phrase it as the requirement
 * ("the pg dialect needs the postgres-js driver"). `alternative`, when the
 * reader has a second way out, follows the install line.
 */
export async function importDriver<T>(
  pkg: string,
  load: () => Promise<T>,
  hint: string,
  alternative?: string,
): Promise<T> {
  try {
    return await load();
  } catch (error: any) {
    if (!isMissingPackage(error, pkg)) { throw error; }
    throw new Error(
      `[@colyseus/database] ${hint}:\n\n    npm install --save ${pkg}\n` +
      (alternative ? `\n${alternative}\n` : ''),
      { cause: error },
    );
  }
}
