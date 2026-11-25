import neo4j from 'neo4j-driver';
import { cfg } from './config.js';

export const driver = neo4j.driver(cfg.neo4jUri, neo4j.auth.basic(cfg.neo4jUser, cfg.neo4jPassword));

export async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = driver.session();
  try { return (await s.run(cypher, params)).records; } finally { await s.close(); }
}

export const int = (n: number) => neo4j.int(Math.trunc(n));

// Graph model:
//   (:Note {id,type,title,body,x,y,rotation,z,createdAt,updatedAt,deleted,embedding})
//   (:Note)-[:LINKED {id,label,createdBy,createdAt}]->(:Note)      links made by the founder (or accepted AI suggestions)
//   (:Debate {id,status,summary,startedAt})-[:ABOUT]->(:Note)
//   (:Debate)-[:HAS_TURN]->(:Turn {id,seq,speaker,content,createdAt})
export async function initSchema() {
  await run('CREATE CONSTRAINT note_id IF NOT EXISTS FOR (n:Note) REQUIRE n.id IS UNIQUE');
  await run('CREATE CONSTRAINT debate_id IF NOT EXISTS FOR (d:Debate) REQUIRE d.id IS UNIQUE');
  await run('CREATE CONSTRAINT turn_id IF NOT EXISTS FOR (t:Turn) REQUIRE t.id IS UNIQUE');
  await run(
    `CREATE VECTOR INDEX note_embedding IF NOT EXISTS FOR (n:Note) ON (n.embedding)
     OPTIONS {indexConfig: {\`vector.dimensions\`: ${cfg.embedDims}, \`vector.similarity_function\`: 'cosine'}}`,
  );
  await run('CREATE FULLTEXT INDEX note_text IF NOT EXISTS FOR (n:Note) ON EACH [n.title, n.body]');
}

export async function closeGraph() { await driver.close(); }
