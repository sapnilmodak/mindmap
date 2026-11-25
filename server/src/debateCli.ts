// Run a debate from the terminal, so prompts can be tuned before any animation exists.
//   npm run debate -- --list
//   npm run debate -- <note id | part of a title | --latest> [--turns 4] [--fake]
// --fake uses scripted colleagues (no API keys, no cost) to show the flow.
import { cfg } from './config.js';
import { closeGraph, initSchema } from './graph.js';
import { listWall } from './notes.js';
import { runDebate } from './debate.js';
import { claudeProvider, gptProvider } from './providers.js';
import { demoProviders } from './demoProviders.js';
import type { DebateEvent } from '@idea-office/shared';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--turns');
const color = (c: number, s: string) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);

async function main() {
  await initSchema();
  const { notes } = await listWall();
  if (flag('list') || (!target && !flag('latest'))) {
    console.log(notes.length ? 'Notes on the wall (newest first):' : 'The wall is empty.');
    for (const n of [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) console.log(`  ${n.id}  [${n.type}] ${n.title}`);
    console.log('\nRun:  npm run debate -- <id | part of a title | --latest> [--turns 4] [--fake]');
    return;
  }
  const t = flag('latest') ? [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : notes.find((n) => n.id === target) ?? notes.find((n) => n.title.toLowerCase().includes(String(target).toLowerCase()));
  if (!t) { console.error(`No note matches "${target}". Try --list.`); process.exitCode = 1; return; }

  const fake = flag('fake');
  if (!fake && (!cfg.anthropicKey || !cfg.openaiKey)) {
    console.error(`Missing ${[!cfg.anthropicKey && 'ANTHROPIC_API_KEY', !cfg.openaiKey && 'OPENAI_API_KEY'].filter(Boolean).join(' and ')} in idea-office/.env.\nAdd them, or add --fake to see the flow with scripted colleagues.`);
    process.exitCode = 1; return;
  }
  const providers = fake ? demoProviders(10) : { claude: claudeProvider(), gpt: gptProvider() };
  const turns = opt('turns') ? Number(opt('turns')) : 4;
  console.log(color(1, `\nDebating: "${t.title}"`) + color(90, `  [${t.type}] ${fake ? '(fake colleagues)' : `${cfg.claudeModel} vs ${cfg.openaiModel}`}\n`));

  const byId = new Map(notes.map((n) => [n.id, n.title]));
  let open = false;
  const onEvent = (e: DebateEvent) => {
    if (e.type === 'turn_started') { process.stdout.write(color(e.speaker === 'claude' ? 33 : 32, `${e.speaker === 'claude' ? 'Claude' : 'GPT'}: `)); open = true; }
    else if (e.type === 'turn_delta') process.stdout.write(e.text);
    else if (e.type === 'turn_done' && open) { process.stdout.write('\n\n'); open = false; }
  };
  const r = await runDebate({ noteId: t.id, providers, turns, onEvent });

  if (r.status !== 'done' || !r.summary) {
    console.log(color(31, `\nDebate ${r.status}${r.error ? `: ${r.error.provider} (${r.error.reason})` : ''}. What was said is saved (debate ${r.debateId}).`));
    process.exitCode = 1; return;
  }
  const s = r.summary;
  console.log(color(1, `Verdict: ${s.verdict.toUpperCase()}`));
  console.log(s.summary);
  const list = (h: string, xs: string[]) => xs.length && console.log(`\n${color(1, h)}\n${xs.map((x) => `  - ${x}`).join('\n')}`);
  list('Key points', s.key_points); list('Risks', s.risks); list('Next steps', s.next_steps);
  if (s.suggested_links.length) console.log(`\n${color(1, 'Suggested links')}\n${s.suggested_links.map((l) => `  - ${byId.get(l.target_note_id) ?? l.target_note_id}${l.label ? `  (${l.label})` : ''}${l.reason ? `: ${l.reason}` : ''}`).join('\n')}`);
  if (s.suggested_notes.length) console.log(`\n${color(1, 'Suggested notes')}\n${s.suggested_notes.map((n) => `  - [${n.type}] ${n.title}`).join('\n')}`);
  console.log(color(90, `\nSaved as debate ${r.debateId}.`));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(closeGraph);
