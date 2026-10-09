# syntax=docker/dockerfile:1

# ---- build: install everything, build the admin UI, compile the API ----
FROM oven/bun:1-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY api/package.json api/
COPY app/package.json app/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run -F commerce-app build
# NODE_ENV is inlined by Bun's bundler, so it must be set here (not only at run
# time) for the binary to serve the built UI in production.
RUN NODE_ENV=production bun build --compile --minify --target=bun \
    api/src/cli.ts --outfile dist/server

# ---- runtime: one self-contained binary on a minimal base ----
FROM gcr.io/distroless/base-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist/server /app/server
COPY --from=build /app/app/dist /app/app/dist
EXPOSE 8080
# `serve` applies migrations (idempotent and database-locked) then starts, so a
# fresh deploy self-applies without a shell or a second process.
ENTRYPOINT ["/app/server"]
CMD ["serve"]
