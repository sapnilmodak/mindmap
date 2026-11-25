# One file, two images: `server` (API) and `web` (built UI behind nginx). docker-compose.yml picks the target.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

FROM deps AS server
COPY shared shared
COPY server server
EXPOSE 8787
CMD ["npm", "run", "start", "-w", "server"]

FROM deps AS webbuild
COPY shared shared
COPY web web
RUN npm run build -w web

FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=webbuild /app/web/dist /usr/share/nginx/html
