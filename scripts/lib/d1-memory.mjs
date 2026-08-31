/**
 * A D1-shaped database, in memory, backed by node:sqlite.
 *
 * The Worker's tests were regexes over `worker/index.js` — they could assert
 * that the string `revoked_at IS NULL` appeared somewhere, which is not the
 * same as asserting that revoking a grant stops the paywall lifting. This
 * closes that gap without adding a dependency: node:sqlite ships with Node 22,
 * the real migration files are applied to it, and the Worker's own handlers
 * run against it unmodified.
 *
 * The adapter is deliberately thin. It implements exactly the D1 surface this
 * codebase uses — prepare().bind().first() / .all() / .run() — and nothing
 * else, so a handler that starts using a method D1 has and this does not fails
 * loudly here rather than passing a test and failing in production.
 *
 * Two real differences from D1 to keep in mind:
 *   - D1 is remote and async; this resolves immediately. A test can therefore
 *     pass while the real thing has a race. Ordering bugs are not caught here.
 *   - node:sqlite returns null-prototype rows. They are copied into plain
 *     objects, because `{...row}` and JSON.stringify behave differently
 *     otherwise and the handlers spread rows.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const plain = (row) => (row == null ? null : { ...row });

class Stmt {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    /* D1 accepts undefined and stores it as NULL; node:sqlite throws. */
    this.args = args.map((a) => (a === undefined ? null : a));
    return this;
  }
  #prepared() {
    return this.db.prepare(this.sql);
  }
  async first(column) {
    const row = plain(this.#prepared().get(...this.args));
    if (row && column !== undefined) return row[column];
    return row;
  }
  async all() {
    const results = this.#prepared().all(...this.args).map(plain);
    return { results, success: true, meta: { rows_read: results.length } };
  }
  async run() {
    const info = this.#prepared().run(...this.args);
    return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
  }
}

/**
 * @param {string[]} migrationFiles absolute paths, applied in the order given
 */
export function memoryD1(migrationFiles = []) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const file of migrationFiles) db.exec(fs.readFileSync(file, 'utf8'));
  return {
    prepare: (sql) => new Stmt(db, sql),
    /* D1's batch, for the handlers that use it. */
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
    _raw: db,
  };
}

/** Every migration in the repo, in filename order — which is the applied order. */
export function allMigrations(root) {
  const dir = path.join(root, 'migrations');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(dir, f));
}
