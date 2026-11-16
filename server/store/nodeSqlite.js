import fs from 'node:fs';
import path from 'node:path';
import { SqlStore, createNodeSqliteDriver } from './Store.js';

export async function openDefaultSqliteStore(dbPath = 'data/blinko.sqlite') {
  const { DatabaseSync } = await import('node:sqlite');
  const resolved = path.resolve(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  return new SqlStore(createNodeSqliteDriver(db));
}
