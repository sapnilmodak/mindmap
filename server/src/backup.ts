// A JSON copy of the whole wall once a day, so a bad delete or a lost Docker volume never costs the founder their thinking.
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildExport } from './exporter.js';
import { localDate } from './usage.js';

const PATTERN = /^wall-\d{4}-\d{2}-\d{2}\.json$/;

// Writes backups/wall-YYYY-MM-DD.json unless today's already exists, and keeps only the newest `keep` files.
// Returns the path written, or null if today's backup was already there.
export async function writeDailyBackup(dir: string, now = new Date(), keep = 14): Promise<string | null> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `wall-${localDate(now)}.json`);
  if (existsSync(file)) return null;
  writeFileSync(file, JSON.stringify(await buildExport(now), null, 2), 'utf8');
  const old = readdirSync(dir).filter((f) => PATTERN.test(f)).sort().reverse().slice(keep);
  for (const f of old) unlinkSync(join(dir, f));
  return file;
}

// Once now, then every 6 hours (so a server left running past midnight still gets the new day's copy).
export function scheduleBackups(dir: string, onError: (e: unknown) => void = () => undefined): () => void {
  const tick = () => { writeDailyBackup(dir).catch(onError); };
  tick();
  const t = setInterval(tick, 6 * 60 * 60 * 1000);
  t.unref();
  return () => clearInterval(t);
}
