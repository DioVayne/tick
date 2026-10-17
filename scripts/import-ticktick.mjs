// Gebruik: node scripts/import-ticktick.mjs <backup.csv> [uitvoer.sql]
// Maakt een SQL-bestand dat je met `wrangler d1 execute tick --remote --file=...` inleest.
import fs from 'node:fs';
import { readTickTickText, tickTickRows } from '../public/ticktick.js';

const [src, out = 'import.sql'] = process.argv.slice(2);
if (!src) { console.error('Usage: node scripts/import-ticktick.mjs <backup.csv> [output.sql]'); process.exit(1); }

const { tasks, skipped } = tickTickRows(readTickTickText(fs.readFileSync(src, 'utf8')));
const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const lines = tasks.map((t) =>
  'INSERT OR REPLACE INTO tasks (id,title,description,list,parent_id,position,remind_at,notified,done,done_at,source,created_at,updated_at) VALUES (' +
  [q(t.id), q(t.title), q(t.description), q(t.list), q(t.parent_id), t.position, q(t.remind_at), 0, t.done ? 1 : 0,
    q(t.done_at), q('import'), q(t.created_at), q(t.created_at)].join(',') + ');');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`${lines.length} tasks written to ${out} (${skipped} without a title skipped)`);
