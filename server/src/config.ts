import { config as load } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
load({ path: resolve(here, '../../.env') });

const env = (k: string, d = '') => process.env[k] ?? d;

export const cfg = {
  host: env('HOST', '127.0.0.1'),
  port: Number(env('PORT', '8787')),
  neo4jUri: env('NEO4J_URI', 'bolt://127.0.0.1:7687'),
  neo4jUser: env('NEO4J_USER', 'neo4j'),
  neo4jPassword: env('NEO4J_PASSWORD'),
  anthropicKey: env('ANTHROPIC_API_KEY'),
  openaiKey: env('OPENAI_API_KEY'),
  claudeModel: env('CLAUDE_MODEL', 'claude-sonnet-5-5'),
  scepticModel: env('SCEPTIC_MODEL', 'claude-haiku-5-5'),     // the second colleague: same Anthropic key, another model
  embedModel: env('EMBED_MODEL', 'text-embedding-3-small'),
  embedDims: Number(env('EMBED_DIMS', '1536')),
};
