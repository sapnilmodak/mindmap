# Idea Wall Office

A 3D office where you pin business notes on a wall, link them, and watch two AI colleagues debate them in Hindi: a Claude analyst (Sonnet) and a sceptic (Haiku), on one Anthropic key. An OpenAI key is optional and only powers similar-note search.

## Run it (needs only Docker)

```bash
cp .env.example .env      # set NEO4J_PASSWORD; add API keys, or leave them empty for demo mode
docker compose up -d --build
```

Open http://localhost:8088. Stop with `docker compose down`. Your notes stay in a Docker volume
(`docker compose down -v` deletes them). Daily backups appear in `backups/`.

Check the keys and the database: `docker compose exec server npm run smoke -w server`.
After editing `.env` or the prompts in `server/src/prompts/`: `docker compose up -d --build`.

## Develop (needs Node 22 and Docker)

```bash
npm install
npm run db:up         # database only
npm run dev:server    # API on 127.0.0.1:8787
npm run dev:web       # UI on http://localhost:5173
npm test              # uses the real database: run while the app is idle
```

The app has no login. It is published on 127.0.0.1 only; do not expose it to a network.
