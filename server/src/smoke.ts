// npm run smoke: checks Neo4j, the vector index, both colleagues and embeddings. Prints only pass/fail, never keys.
import { cfg } from './config.js';
import { closeGraph, initSchema, run } from './graph.js';
import { embed } from './embeddings.js';
import { claudeProvider, type Provider } from './providers.js';

let failed = 0;
async function check(name: string, fn: () => Promise<string>) {
  try { console.log(`PASS  ${name}: ${await fn()}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}: ${(e as Error).message.split('\n')[0]}`); }
}
async function say(p: Provider) {
  let out = '';
  for await (const t of p.stream('Reply with one short sentence.', [{ role: 'user', content: 'Say hello to a founder.' }], 60)) out += t;
  if (!out.trim()) throw new Error('empty reply');
  return out.trim().slice(0, 70);
}

await check('neo4j + schema', async () => { await initSchema(); return `connected, ${(await run('RETURN 1 AS x')).length} row`; });
await check('vector index online', async () => {
  const r = await run("SHOW INDEXES YIELD name, state WHERE name = 'note_embedding' RETURN state");
  if (!r.length) throw new Error('index missing');
  return String(r[0].get('state'));
});
await check(`claude (${cfg.claudeModel})`, () => say(claudeProvider()));
await check(`sceptic (${cfg.scepticModel})`, () => say(claudeProvider('gpt')));
// Optional: only similar-note (vector) search needs OpenAI.
if (cfg.openaiKey) await check(`openai embeddings (${cfg.embedModel}, optional)`, async () => `${(await embed('hello')).length} dims`);
else console.log('SKIP  openai embeddings: no OPENAI_API_KEY, similar-note search is off');

await closeGraph();
process.exit(failed ? 1 : 0);
