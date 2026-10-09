# syntax=docker/dockerfile:1

# ---- build: install everything and build the admin UI ----
FROM oven/bun:1-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY api/package.json api/
COPY app/package.json app/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run -F commerce-app build

# ---- runtime: the API serves the built UI from the same origin ----
FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
COPY api/package.json api/
COPY app/package.json app/
RUN bun install --production --frozen-lockfile
COPY api/src api/src
COPY api/scripts api/scripts
COPY api/tsconfig.json api/
COPY api/bunfig.toml api/
COPY --from=build /app/app/dist app/dist
EXPOSE 3000
# Migrations are idempotent and database-locked, so a fresh deploy self-applies.
CMD ["sh", "-c", "bun run -F commerce-api migrate && bun run -F commerce-api start"]
