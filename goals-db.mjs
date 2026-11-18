import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const legacy = process.env.GOALS_FILE
  ? resolve(process.env.GOALS_FILE)
  : fileURLToPath(new URL('./.goals.json', import.meta.url));
const path = process.env.GOALS_DB_FILE
  ? resolve(process.env.GOALS_DB_FILE)
  : resolve(dirname(legacy), 'goals.sqlite');
mkdirSync(dirname(path), { recursive: true });
export const goalsDb = new DatabaseSync(path);
goalsDb.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS goals (
    scope TEXT PRIMARY KEY,
    weekly INTEGER NOT NULL CHECK (weekly >= 0),
    monthly INTEGER NOT NULL CHECK (monthly >= 0)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY) STRICT;
`);

const get = goalsDb.prepare('SELECT weekly, monthly FROM goals WHERE scope = ?');
const put = goalsDb.prepare(`
  INSERT INTO goals (scope, weekly, monthly) VALUES (?, ?, ?)
  ON CONFLICT(scope) DO UPDATE SET weekly = excluded.weekly, monthly = excluded.monthly
`);
const removeTarget = goalsDb.prepare('DELETE FROM goals WHERE scope = ?');
const emptyTargets = { weekly: 0, monthly: 0 };

function transaction(action) {
  goalsDb.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    goalsDb.exec('COMMIT');
    return result;
  } catch (error) {
    goalsDb.exec('ROLLBACK');
    throw error;
  }
}

transaction(() => {
  const migration = 'import_legacy_goals';
  if (goalsDb.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migration)) return;
  let stored;
  try {
    stored = JSON.parse(readFileSync(legacy, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (stored) {
    const records = [['', stored.company ?? stored], ...Object.entries(stored.sellers ?? {})];
    for (const [scope, record] of records) {
      const { weekly = 0, monthly = 0 } = record;
      if (![weekly, monthly].every(value => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error('Meta inválida no arquivo legado.');
      }
      if (weekly || monthly) put.run(scope, weekly, monthly);
    }
  }
  goalsDb.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration);
});

export function getGoal(scope) {
  return get.get(scope) ?? emptyTargets;
}

export function listSellerGoals() {
  const rows = goalsDb.prepare("SELECT scope, weekly, monthly FROM goals WHERE scope <> ''").all();
  return new Map(rows.map(({ scope, weekly, monthly }) => [scope, { weekly, monthly }]));
}

export function updateGoal({ seller, weekly, monthly, remove }) {
  return transaction(() => {
    const targets = remove ? { ...getGoal(seller), [remove]: 0 } : { weekly, monthly };
    if (targets.weekly || targets.monthly) put.run(seller, targets.weekly, targets.monthly);
    else removeTarget.run(seller);
    return targets;
  });
}
