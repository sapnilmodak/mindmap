import { cfg } from './config.js';
import { closeGraph, initSchema } from './graph.js';
import { embedMissing } from './embeddings.js';
import { buildApp } from './app.js';
import { isDemo } from './providerSelect.js';
import { scheduleBackups } from './backup.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = await buildApp();
await initSchema();
void embedMissing().then((n) => n && app.log.info(`embedded ${n} existing notes`));
await app.listen({ host: cfg.host, port: cfg.port });
const backupDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../backups');
scheduleBackups(backupDir, (e) => app.log.error(e, 'daily backup failed'));
if (isDemo()) app.log.warn('No API keys set: debates use scripted DEMO colleagues. Add ANTHROPIC_API_KEY and OPENAI_API_KEY to .env for real ones.');

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await app.close(); await closeGraph(); process.exit(0); });
