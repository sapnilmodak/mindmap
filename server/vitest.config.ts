import { defineConfig } from 'vitest/config';

// The server tests share one real Neo4j database and one set of settings (token budget, turns, auto-debate), and some of them
// change those on purpose. Running the files in parallel made them trip over each other, so they run one file at a time.
// They also clean up after themselves, but run them while the app is idle: a test that sets the daily budget to 1 token
// would refuse a debate you start at that moment.
export default defineConfig({ test: { fileParallelism: false } });
