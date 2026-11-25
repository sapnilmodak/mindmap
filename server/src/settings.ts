import { run } from './graph.js';

// Small key/value settings kept in the graph as (:Setting {key, value}).
export async function getSetting(key: string): Promise<string> {
  const r = await run('MATCH (s:Setting {key:$key}) RETURN s.value AS v', { key });
  return r.length ? String(r[0].get('v') ?? '') : '';
}
export async function setSetting(key: string, value: string): Promise<void> {
  await run('MERGE (s:Setting {key:$key}) SET s.value = $value', { key, value });
}

export const FOUNDER_PROFILE = 'founderProfile';
export const getFounderProfile = () => getSetting(FOUNDER_PROFILE);
