// Token usage per day, from the debates already stored in the graph. Tokens, not dollars: prices change and differ per model,
// while a token budget is exact and is what actually limits spending.
import { run } from './graph.js';

export interface Usage { debates: number; tokensIn: number; tokensOut: number; tokens: number }
export interface DayUsage { date: string; tokens: number; debates: number }

export function startOfLocalDay(d = new Date()): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
const pad = (n: number) => String(n).padStart(2, '0');
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export async function usageSince(sinceIso: string): Promise<Usage> {
  const r = await run(
    `MATCH (d:Debate) WHERE d.startedAt >= $since
     RETURN count(d) AS debates, coalesce(sum(d.tokensIn), 0) AS tin, coalesce(sum(d.tokensOut), 0) AS tout`, { since: sinceIso });
  const tin = Number(r[0].get('tin')), tout = Number(r[0].get('tout'));
  return { debates: Number(r[0].get('debates')), tokensIn: tin, tokensOut: tout, tokens: tin + tout };
}

// The last `days` calendar days (today last), zero-filled, for the small usage chart.
export function groupByDay(rows: { startedAt: string; tokens: number }[], days: number, now = new Date()): DayUsage[] {
  const out: DayUsage[] = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); out.push({ date: localDate(d), tokens: 0, debates: 0 }); }
  const byDate = new Map(out.map((o) => [o.date, o]));
  for (const r of rows) { const o = byDate.get(localDate(new Date(r.startedAt))); if (o) { o.tokens += r.tokens; o.debates += 1; } }
  return out;
}

export async function usageReport(budget: number, now = new Date(), days = 7) {
  const since = new Date(now); since.setDate(since.getDate() - (days - 1));
  const rows = (await run(
    'MATCH (d:Debate) WHERE d.startedAt >= $since RETURN d.startedAt AS startedAt, coalesce(d.tokensIn, 0) + coalesce(d.tokensOut, 0) AS tokens',
    { since: startOfLocalDay(since).toISOString() })).map((r) => ({ startedAt: r.get('startedAt') as string, tokens: Number(r.get('tokens')) }));
  const daysUsage = groupByDay(rows, days, now);
  const today = daysUsage[daysUsage.length - 1];
  return { budget, today, remaining: budget > 0 ? Math.max(0, budget - today.tokens) : null, days: daysUsage };
}

// Today's tokens (local midnight to now) and whether the budget is used up. budget 0 means no limit.
export async function budgetStatus(budget: number, now = new Date()) {
  const used = (await usageSince(startOfLocalDay(now).toISOString())).tokens;
  return { used, budget, exceeded: budget > 0 && used >= budget };
}
