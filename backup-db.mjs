import { resolve } from 'node:path';
import { backup } from 'node:sqlite';
import { goalsDb } from './goals-db.mjs';

const destination = process.argv[2];
if (!destination) throw new Error('Informe o caminho do arquivo de backup.');
try {
  await backup(goalsDb, resolve(destination));
  console.log('Backup SQLite concluído.');
} finally {
  goalsDb.close();
}
