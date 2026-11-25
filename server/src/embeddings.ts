import OpenAI from 'openai';
import { cfg } from './config.js';
import { run } from './graph.js';

let client: OpenAI | null = null;
const openai = () => (client ??= new OpenAI({ apiKey: cfg.openaiKey }));

export async function embed(text: string): Promise<number[]> {
  const r = await openai().embeddings.create({ model: cfg.embedModel, input: text.slice(0, 8000), dimensions: cfg.embedDims });
  return r.data[0].embedding;
}

export const noteText = (title: string, body: string) => `${title}\n${body}`.trim();

// Embeds a note and stores the vector on its node. Never throws: a note without a
// vector still works, it just isn't found by similarity search until re-embedded.
export async function embedNote(id: string, title: string, body: string): Promise<boolean> {
  try {
    const vec = await embed(noteText(title, body));
    await run('MATCH (n:Note {id:$id}) CALL db.create.setNodeVectorProperty(n, "embedding", $vec)', { id, vec });
    return true;
  } catch (e) {
    console.warn(`[embed] note ${id} not embedded: ${(e as Error).message}`);
    return false;
  }
}

export async function embedMissing(): Promise<number> {
  const rows = await run('MATCH (n:Note) WHERE n.embedding IS NULL AND n.deleted = false RETURN n.id AS id, n.title AS title, n.body AS body');
  let ok = 0;
  for (const r of rows) if (await embedNote(r.get('id'), r.get('title'), r.get('body'))) ok++;
  return ok;
}
