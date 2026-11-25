import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import type { DebateEvent } from '@idea-office/shared';
import { LinkCreate, LinkPatch, NoteCreate, NotePatch } from '@idea-office/shared';
import * as notes from './notes.js';
import { buildContext, renderContext } from './retrieval.js';
import { getDebate, listDebatesForNote } from './debateStore.js';
import { cancelDebate, eventsFromStored, getRun, interject, isTerminal, startDebate } from './debateRunner.js';
import { acceptSuggestion, dismissSuggestion } from './suggestions.js';
import { getSetting, setSetting, FOUNDER_PROFILE } from './settings.js';
import { isDemo, providersFor } from './providerSelect.js';
import { cfg } from './config.js';
import { budgetStatus, usageReport } from './usage.js';
import { buildExport, toMarkdown } from './exporter.js';
import type { Provider } from './providers.js';

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
const AUTO_DEBATE = 'autoDebate', TURNS = 'turnsPerDebate', BUDGET = 'dailyTokenBudget';
export const DEFAULT_TURNS = 4, DEFAULT_DAILY_TOKENS = 200_000;      // roughly 15 debates a day; 0 switches the limit off

export interface AppOptions { providers?: () => { claude: Provider; gpt: Provider }; logger?: boolean }

export async function buildApp(opts: AppOptions = {}) {
  const providers = opts.providers ?? providersFor;
  const app = Fastify({ logger: opts.logger === false ? false : { level: 'info', redact: ['req.headers.authorization'] } });
  await app.register(cors, { origin: [LOCAL_ORIGIN] });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err?.issues) return reply.code(400).send({ error: 'invalid_input', issues: err.issues });
    if (err?.statusCode >= 400 && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });   // e.g. malformed JSON: the caller's fault, not a server error
    app.log.error(err);
    reply.code(500).send({ error: 'server_error' });
  });

  app.get('/api/health', async () => ({ ok: true, demo: isDemo() }));
  app.get('/api/wall', async () => notes.listWall());

  // ---- notes and links ----
  app.post('/api/notes', async (req, reply) => reply.code(201).send(await notes.createNote(NoteCreate.parse(req.body))));
  app.patch<{ Params: { id: string } }>('/api/notes/:id', async (req, reply) =>
    (await notes.patchNote(req.params.id, NotePatch.parse(req.body))) ?? reply.code(404).send({ error: 'not_found' }));
  app.delete<{ Params: { id: string } }>('/api/notes/:id', async (req, reply) =>
    (await notes.deleteNote(req.params.id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' }));

  app.post('/api/links', async (req, reply) => {
    const r = await notes.createLink(LinkCreate.parse(req.body));
    if (r.ok) return reply.code(201).send(r.link);
    return reply.code(r.reason === 'missing' ? 404 : 409).send({ error: r.reason });
  });
  app.patch<{ Params: { id: string } }>('/api/links/:id', async (req, reply) =>
    (await notes.updateLink(req.params.id, LinkPatch.parse(req.body).label)) ?? reply.code(404).send({ error: 'not_found' }));
  app.delete<{ Params: { id: string } }>('/api/links/:id', async (req, reply) =>
    (await notes.deleteLink(req.params.id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' }));

  // What the workers would be told about a note. Useful for debugging retrieval.
  app.get<{ Params: { id: string } }>('/api/notes/:id/context', async (req, reply) => {
    const c = await buildContext(req.params.id);
    return c ? { context: c, rendered: renderContext(c) } : reply.code(404).send({ error: 'not_found' });
  });

  // ---- settings ----
  const Settings = z.object({
    autoDebate: z.boolean().optional(), founderProfile: z.string().max(2000).optional(),
    turnsPerDebate: z.number().int().min(2).max(6).optional(), dailyTokenBudget: z.number().int().min(0).max(10_000_000).optional(),
  });
  const intSetting = async (key: string, fallback: number) => { const v = await getSetting(key); return v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v); };
  const readSettings = async () => ({
    autoDebate: (await getSetting(AUTO_DEBATE)) !== '0',               // on unless switched off
    founderProfile: await getSetting(FOUNDER_PROFILE),
    turnsPerDebate: await intSetting(TURNS, DEFAULT_TURNS),
    dailyTokenBudget: await intSetting(BUDGET, DEFAULT_DAILY_TOKENS),
    demo: isDemo(),
    models: { claude: cfg.claudeModel, gpt: cfg.openaiModel },          // names only; the keys never leave the server
  });
  app.get('/api/settings', readSettings);
  app.put('/api/settings', async (req) => {
    const s = Settings.parse(req.body);
    if (s.autoDebate !== undefined) await setSetting(AUTO_DEBATE, s.autoDebate ? '1' : '0');
    if (s.founderProfile !== undefined) await setSetting(FOUNDER_PROFILE, s.founderProfile.trim());
    if (s.turnsPerDebate !== undefined) await setSetting(TURNS, String(s.turnsPerDebate));
    if (s.dailyTokenBudget !== undefined) await setSetting(BUDGET, String(s.dailyTokenBudget));
    return readSettings();
  });

  // ---- debates ----
  const Start = z.object({ turns: z.number().int().min(2).max(6).optional() }).default({});
  app.post<{ Params: { id: string } }>('/api/notes/:id/debate', async (req, reply) => {
    const body = Start.parse(req.body ?? {});
    const st = await readSettings();
    const b = await budgetStatus(st.dailyTokenBudget);
    if (b.exceeded) return reply.code(429).send({ error: 'budget', used: b.used, budget: b.budget });     // today's token budget is spent
    const r = await startDebate({ noteId: req.params.id, providers: providers(), turns: body.turns ?? st.turnsPerDebate });
    if (r.ok) return reply.code(202).send({ debateId: r.debateId, demo: isDemo() });
    return reply.code(r.reason === 'busy' ? 409 : 404).send({ error: r.reason });
  });
  app.get<{ Params: { id: string } }>('/api/notes/:id/debates', async (req) => listDebatesForNote(req.params.id));
  app.get<{ Params: { id: string } }>('/api/debates/:id', async (req, reply) => (await getDebate(req.params.id)) ?? reply.code(404).send({ error: 'not_found' }));
  app.post<{ Params: { id: string } }>('/api/debates/:id/cancel', async (req, reply) =>
    cancelDebate(req.params.id) ? { ok: true } : reply.code(409).send({ error: 'not_running' }));
  app.post<{ Params: { id: string } }>('/api/debates/:id/message', async (req, reply) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(500) }).parse(req.body);
    return interject(req.params.id, text) ? { ok: true } : reply.code(409).send({ error: 'not_running' });
  });

  // Server-sent events. A live debate replays everything said so far and then streams; a finished one (even after a restart)
  // is rebuilt from the database, so the same stream also replays old debates.
  app.get<{ Params: { id: string } }>('/api/debates/:id/stream', async (req, reply) => {
    const run = getRun(req.params.id);
    const stored = run ? null : await getDebate(req.params.id);
    if (!run && !stored) return reply.code(404).send({ error: 'not_found' });

    reply.hijack();
    const res = reply.raw;
    const origin = req.headers.origin;
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no',
      ...(origin && LOCAL_ORIGIN.test(origin) ? { 'access-control-allow-origin': origin } : {}),
    });
    const send = (e: DebateEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    const onEvent = (e: DebateEvent) => { send(e); if (isTerminal(e)) end(); };
    const end = () => { clearInterval(heartbeat); run?.listeners.delete(onEvent); if (!res.writableEnded) res.end(); };
    req.raw.on('close', end);

    if (!run) { eventsFromStored(stored!).forEach(send); return end(); }
    run.events.forEach(send);
    if (run.finished || run.events.some(isTerminal)) return end();
    run.listeners.add(onEvent);
  });

  // ---- usage and export ----
  app.get('/api/usage', async () => usageReport((await readSettings()).dailyTokenBudget));
  app.get<{ Querystring: { format?: string } }>('/api/export', async (req, reply) => {
    const data = await buildExport();
    const day = data.exportedAt.slice(0, 10);
    if (req.query.format === 'md') {
      return reply.header('content-type', 'text/markdown; charset=utf-8').header('content-disposition', `attachment; filename="idea-wall-${day}.md"`).send(toMarkdown(data));
    }
    return reply.header('content-disposition', `attachment; filename="idea-wall-${day}.json"`).send(data);
  });

  // ---- suggestions ----
  const Accept = z.object({ note: z.object({ id: z.string().uuid().optional(), x: z.number().min(-4.5).max(4.5).optional(), y: z.number().min(0).max(3.5).optional() }).optional() }).default({});
  app.post<{ Params: { id: string } }>('/api/suggestions/:id/accept', async (req, reply) => {
    const r = await acceptSuggestion(req.params.id, Accept.parse(req.body ?? {}).note);
    if (r.ok) return r;
    return reply.code(r.reason === 'not_found' ? 404 : 409).send({ error: r.reason });
  });
  app.post<{ Params: { id: string } }>('/api/suggestions/:id/dismiss', async (req, reply) => {
    const r = await dismissSuggestion(req.params.id);
    return r === 'ok' ? { ok: true } : reply.code(r === 'not_found' ? 404 : 409).send({ error: r });
  });

  return app;
}
